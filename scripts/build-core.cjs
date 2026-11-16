const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const core = path.join(root, "core");
function run(cmd, args) {
  execFileSync(cmd, args, {cwd: root, stdio: "inherit", windowsHide: true});
}
run("uv", ["sync", "--project", core, "--frozen", "--group", "build"]);
const rust = execFileSync("rustc", ["-vV"], {encoding:"utf8", windowsHide:true});
const target = /^host: (.+)$/m.exec(rust)[1].trim();
if (process.env.TAURI_ENV_TARGET_TRIPLE && process.env.TAURI_ENV_TARGET_TRIPLE !== target) {
  throw new Error("Python sidecar must be built on its native target; cross-compilation is not supported.");
}
run("uv", ["run", "--project", core, "--frozen", "--group", "build", "python", "-m", "PyInstaller",
  "--noconfirm", "--onefile", "--console", "--name", "tack-core",
  "--distpath", path.join(core, "dist"), "--workpath", path.join(core,"build","work"),
  "--specpath", path.join(core,"build"), "--paths", core,
  "--collect-submodules", "keyring.backends", "--collect-all", "semantic_text_splitter",
  "--hidden-import", "openai", "--hidden-import", "pypdf", path.join(core,"desktop_entry.py")]);
const suffix = process.platform === "win32" ? ".exe" : "";
const dest = path.join(root, "src-tauri", "binaries");
fs.mkdirSync(dest,{recursive:true});
fs.copyFileSync(path.join(core,"dist",`tack-core${suffix}`),path.join(dest,`tack-core-${target}${suffix}`));
console.log(`Built tack-core for ${target}`);
