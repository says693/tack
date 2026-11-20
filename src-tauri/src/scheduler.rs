use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleState {
    pub ease: f64,
    pub interval_days: i64,
    pub reps: i64,
    pub lapses: i64,
    pub state: String,
    pub due_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleOutcome {
    pub ease: f64,
    pub interval_days: i64,
    pub reps: i64,
    pub lapses: i64,
    pub state: String,
    pub due_on: String,
}

pub const SCHEDULER_ID: &str = "fold-sm2e-1";

/// Grades follow the four-button semantics used by mature spaced repetition
/// systems, without pretending that a stopwatch measures understanding:
/// 0 = 没想起, 1 = 提示后/吃力地想起, 2 = 独立想起, 3 = 毫不费力.
pub fn apply_grade(before: &ScheduleState, grade: i64, today: NaiveDate) -> Result<ScheduleOutcome, String> {
    if !(0..=3).contains(&grade) {
        return Err("评级必须是 0–3。".into());
    }
    let mut ease = before.ease.clamp(1.3, 3.0);
    let mut reps = before.reps;
    let mut lapses = before.lapses;
    let mut interval = before.interval_days;

    if grade == 0 {
        reps = 0;
        lapses += 1;
        interval = 1;
        ease = (ease - 0.2).max(1.3);
        let due = today + Duration::days(interval);
        return Ok(ScheduleOutcome {
            ease: round2(ease),
            interval_days: interval,
            reps,
            lapses,
            state: "relearning".into(),
            due_on: due.format("%Y-%m-%d").to_string(),
        });
    }

    reps += 1;
    interval = if reps == 1 {
        1
    } else if reps == 2 {
        3
    } else {
        ((interval.max(1) as f64) * ease).round() as i64
    };
    if grade == 1 {
        interval = ((interval as f64) * 0.6).round().max(1.0) as i64;
    }
    if grade == 3 {
        interval = ((interval as f64) * 1.3).round().max(1.0) as i64;
    }
    interval = interval.clamp(1, 365);
    ease = match grade {
        3 => ease + 0.10,
        2 => ease,
        _ => ease - 0.15,
    }
    .clamp(1.3, 3.0);
    let due = today + Duration::days(interval);
    Ok(ScheduleOutcome {
        ease: round2(ease),
        interval_days: interval,
        reps,
        lapses,
        state: "review".into(),
        due_on: due.format("%Y-%m-%d").to_string(),
    })
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_state() -> ScheduleState {
        ScheduleState {
            ease: 2.5,
            interval_days: 0,
            reps: 0,
            lapses: 0,
            state: "new".into(),
            due_on: None,
        }
    }

    #[test]
    fn first_success_is_tomorrow() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 15).unwrap();
        let out = apply_grade(&new_state(), 2, today).unwrap();
        assert_eq!(out.interval_days, 1);
        assert_eq!(out.reps, 1);
        assert_eq!(out.due_on, "2026-11-16");
        assert_eq!(out.state, "review");
    }

    #[test]
    fn forget_resets_repetitions_and_counts_lapse() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 15).unwrap();
        let before = ScheduleState {
            ease: 2.5,
            interval_days: 20,
            reps: 5,
            lapses: 1,
            state: "review".into(),
            due_on: Some("2026-11-15".into()),
        };
        let out = apply_grade(&before, 0, today).unwrap();
        assert_eq!(out.reps, 0);
        assert_eq!(out.lapses, 2);
        assert_eq!(out.interval_days, 1);
        assert_eq!(out.ease, 2.3);
        assert_eq!(out.state, "relearning");
    }

    #[test]
    fn hard_shortens_interval_but_still_advances() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 15).unwrap();
        let before = ScheduleState {
            ease: 2.5,
            interval_days: 10,
            reps: 4,
            lapses: 0,
            state: "review".into(),
            due_on: Some("2026-11-15".into()),
        };
        let out = apply_grade(&before, 1, today).unwrap();
        assert_eq!(out.reps, 5);
        assert_eq!(out.interval_days, 15);
        assert_eq!(out.ease, 2.35);
    }

    #[test]
    fn easy_extends_interval() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 15).unwrap();
        let before = ScheduleState {
            ease: 2.5,
            interval_days: 10,
            reps: 4,
            lapses: 0,
            state: "review".into(),
            due_on: Some("2026-11-15".into()),
        };
        let out = apply_grade(&before, 3, today).unwrap();
        assert_eq!(out.interval_days, 33);
        assert_eq!(out.ease, 2.6);
    }

    #[test]
    fn interval_is_capped() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 15).unwrap();
        let before = ScheduleState {
            ease: 3.0,
            interval_days: 360,
            reps: 10,
            lapses: 0,
            state: "review".into(),
            due_on: Some("2026-11-15".into()),
        };
        let out = apply_grade(&before, 3, today).unwrap();
        assert_eq!(out.interval_days, 365);
    }
}
