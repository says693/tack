use std::collections::HashSet;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

const CATALOG_JSON: &str = include_str!("../resources/study-sources.v1.json");
const CATALOG_VERSION: u32 = 1;
static CATALOG: OnceLock<Option<Catalog>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySource {
    pub id: String,
    pub title: String,
    pub publisher: String,
    pub url: String,
    pub license: String,
    pub scope: String,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    version: u32,
    topics: Vec<Topic>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Topic {
    id: String,
    title: String,
    publisher: String,
    url: String,
    license: String,
    scope: String,
    aliases: Vec<String>,
    notes: Vec<String>,
}

fn subject_key(subject: &str) -> String {
    let subject = subject
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let subject = subject
        .strip_suffix(['。', '.'])
        .unwrap_or(&subject)
        .trim_end();
    let subject = [
        "我刚开始学",
        "零基础学习",
        "零基础学",
        "我想学习",
        "我想学",
        "想学习",
        "想学",
        "学习",
    ]
    .into_iter()
    .find_map(|prefix| subject.strip_prefix(prefix))
    .unwrap_or(subject)
    .trim_start();
    match subject.split_once(['，', ',']) {
        Some((topic, goal))
            if topic.trim_end() == "python" && goal.trim_start() == "想弄懂循环" =>
        {
            "python 控制流"
        }
        _ => subject,
    }
    .into()
}

fn bounded_text(value: &str, min: usize, max: usize) -> bool {
    value == value.trim()
        && (min..=max).contains(&value.chars().count())
        && !value.chars().any(char::is_control)
}

fn valid_source_id(id: &str) -> bool {
    id.len() <= 64
        && id.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn valid_reference(url: &str) -> bool {
    bounded_text(url, 1, 512)
        && url.starts_with("https://")
        && !url.chars().any(char::is_whitespace)
        && reqwest::Url::parse(url).is_ok_and(|url| {
            url.scheme() == "https"
                && url.domain().is_some_and(|domain| domain.contains('.'))
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none()
        })
}

impl Catalog {
    fn from_json(raw: &str) -> Option<Self> {
        let catalog: Self = serde_json::from_str(raw).ok()?;
        if catalog.version != CATALOG_VERSION || catalog.topics.is_empty() {
            return None;
        }
        let mut ids = HashSet::new();
        let mut aliases = HashSet::new();
        for topic in &catalog.topics {
            let mut notes = HashSet::new();
            if !valid_source_id(&topic.id)
                || !ids.insert(topic.id.as_str())
                || !bounded_text(&topic.title, 1, 120)
                || !bounded_text(&topic.publisher, 1, 120)
                || !valid_reference(&topic.url)
                || !bounded_text(&topic.license, 1, 240)
                || !bounded_text(&topic.scope, 1, 80)
                || !topic.aliases.contains(&subject_key(&topic.scope))
                || !topic.aliases.iter().all(|alias| {
                    bounded_text(alias, 1, 80)
                        && subject_key(alias) == *alias
                        && aliases.insert(alias.as_str())
                })
                || !(3..=16).contains(&topic.notes.len())
                || !topic.notes.iter().all(|note| {
                    bounded_text(note, 6, 240)
                        && note
                            .strip_suffix('。')
                            .is_some_and(|sentence| !sentence.contains('。'))
                        && notes.insert(note.as_str())
                })
            {
                return None;
            }
        }
        Some(catalog)
    }

    fn source(&self, subject: &str) -> Option<StudySource> {
        let key = subject_key(subject);
        let topic = self
            .topics
            .iter()
            .find(|topic| topic.aliases.contains(&key))?;
        Some(StudySource {
            id: topic.id.clone(),
            title: topic.title.clone(),
            publisher: topic.publisher.clone(),
            url: topic.url.clone(),
            license: topic.license.clone(),
            scope: topic.scope.clone(),
            text: topic.notes.concat(),
        })
    }
}

pub fn sources_for(subject: &str) -> Vec<StudySource> {
    CATALOG
        .get_or_init(|| Catalog::from_json(CATALOG_JSON))
        .as_ref()
        .and_then(|catalog| catalog.source(subject))
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{sources_for, Catalog, CATALOG_JSON, CATALOG_VERSION};

    #[test]
    fn bundled_catalog_preserves_the_intended_primary_references() {
        let catalog = Catalog::from_json(CATALOG_JSON).expect("valid bundled material");
        assert_eq!(catalog.version, CATALOG_VERSION);
        for (scope, id, url, required_note) in [
            (
                "光的反射",
                "optics-reflection",
                "https://science.nasa.gov/universe/glossary/#reflection-law",
                "入射光线、反射光线和法线在同一平面内。",
            ),
            (
                "一元一次方程",
                "algebra-linear-equations",
                "https://www.siyavula.com/read/za/mathematics/grade-10/equations-and-inequalities/04-equations-and-inequalities-01",
                "在等式两边同时乘以或除以同一个非零数，得到的方程与原方程的解相同。",
            ),
            (
                "Python 控制流（if / for / range）",
                "python-control-flow",
                "https://docs.python.org/3.14/tutorial/controlflow.html",
                "range(start, stop, step) 可以指定起点和步长，但仍不包含终点。",
            ),
        ] {
            let source = catalog.source(scope).unwrap_or_else(|| panic!("{scope}"));
            assert_eq!(source.id, id);
            assert_eq!(source.scope, scope);
            assert_eq!(source.url, url);
            assert!(source
                .text
                .split_inclusive('。')
                .any(|note| note == required_note));
        }
    }

    #[test]
    fn malformed_catalogs_are_rejected_as_a_whole() {
        let original: Value = serde_json::from_str(CATALOG_JSON).unwrap();
        for (path, replacement) in [
            ("/version", json!(CATALOG_VERSION + 1)),
            ("/topics", json!([])),
            ("/topics/0/id", json!("not an identifier")),
            ("/topics/1/id", json!("optics-reflection")),
            ("/topics/1/aliases/0", json!("物理")),
            ("/topics/1/aliases/0", json!("Physics")),
            ("/topics/1/aliases/0", json!("我想学物理")),
            ("/topics/1/aliases/3", json!("some unrelated topic")),
            ("/topics/1/url", json!("http://www.siyavula.com/")),
            (
                "/topics/1/url",
                json!("https://example.com@www.siyavula.com/"),
            ),
            ("/topics/1/url", json!("https://127.0.0.1/")),
            ("/topics/1/license", json!(" ")),
            ("/topics/1/notes", json!([])),
            ("/topics/1/notes/0", json!("Bad punctuation")),
            (
                "/topics/1/notes/0",
                json!("包含两条不同的句子。后一句也不应被接受。"),
            ),
        ] {
            let mut bad = original.clone();
            *bad.pointer_mut(path).unwrap() = replacement;
            assert!(Catalog::from_json(&bad.to_string()).is_none(), "{path}");
        }
        let mut unknown_field = original;
        unknown_field["topics"][1]["preparedLesson"] = json!({});
        assert!(Catalog::from_json(&unknown_field.to_string()).is_none());
        assert!(Catalog::from_json("not json").is_none());
    }

    #[test]
    fn broad_subjects_map_to_the_labeled_first_topic() {
        for (subjects, id, scope) in [
            (
                &["物理", "初中物理", "\tPHYSICS "][..],
                "optics-reflection",
                "光的反射",
            ),
            (
                &["数学", "初中数学", "\n Math "][..],
                "algebra-linear-equations",
                "一元一次方程",
            ),
            (
                &["Python", "Python入门", " PYTHON　 入门 "][..],
                "python-control-flow",
                "Python 控制流（if / for / range）",
            ),
        ] {
            for subject in subjects {
                let sources = sources_for(subject);
                assert_eq!(sources.len(), 1, "{subject:?}");
                assert_eq!(sources[0].id, id);
                assert_eq!(sources[0].scope, scope);
            }
        }
    }

    #[test]
    fn specific_topics_accept_only_explicit_aliases() {
        for (subject, id) in [
            ("光的反射", "optics-reflection"),
            ("Law  of Reflection", "optics-reflection"),
            ("一元一次方程", "algebra-linear-equations"),
            ("Python 控制流", "python-control-flow"),
            ("Python 控制流（if / for / range）", "python-control-flow"),
        ] {
            let sources = sources_for(subject);
            assert_eq!(sources.len(), 1, "{subject:?}");
            assert_eq!(sources[0].id, id);
        }

        for subject in [
            "",
            "　  ",
            "生物",
            "物理热力学",
            "Python 并发",
            "光的反射和折射",
            "物理和数学",
            "Math + Physics",
            "Pythonic",
            "光 的反射",
            "我想学 Python 并发",
            "学习物理和数学。",
            "我想学习零基础学 Python",
            "我刚开始学 Python，想弄懂并发。",
        ] {
            assert!(sources_for(subject).is_empty(), "{subject:?}");
        }
    }

    #[test]
    fn familiar_phrasing_resolves_only_supported_topics() {
        for (subject, scope) in [
            ("我想学数学", "一元一次方程"),
            ("学习物理", "光的反射"),
            ("零基础学 Python", "Python 控制流（if / for / range）"),
            (
                "我刚开始学 Python，想弄懂循环。",
                "Python 控制流（if / for / range）",
            ),
        ] {
            let sources = sources_for(subject);
            assert_eq!(sources.len(), 1, "{subject:?}");
            assert_eq!(sources[0].scope, scope);
        }
    }

    #[test]
    fn source_notes_include_provenance_and_sentences_for_evidence() {
        for (subject, publisher, sentence) in [
            ("物理", "NASA Science", "反射角等于入射角。"),
            (
                "数学",
                "Siyavula",
                "在等式两边同时加上或减去同一个数，等式仍然成立。",
            ),
            (
                "Python",
                "Python Software Foundation",
                "range(stop) 从零开始按步长一产生整数，不包含 stop。",
            ),
        ] {
            let sources = sources_for(subject);
            let source = &sources[0];
            assert_eq!(source.publisher, publisher);
            assert!(!source.title.trim().is_empty());
            assert!(source.url.starts_with("https://"));
            assert!(source.license.contains("Fold 原创事实摘要"));
            assert!(source
                .text
                .split_inclusive('。')
                .any(|part| part == sentence));
            assert!(source.text.ends_with('。'));
        }
    }
}
