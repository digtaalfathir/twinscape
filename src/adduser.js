#!/usr/bin/env node
/**
 * Tambah / perbarui akun login dashboard (v1).
 *   node src/adduser.js <username>            → diminta password (tersembunyi)
 *   node src/adduser.js <username> <password> → non-interaktif
 * Disimpan ke data/users.json (scrypt). Hapus akun = edit file itu.
 */
const fs = require("fs");
const auth = require("./auth");

function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin, stdout = process.stdout;
    stdout.write(question);
    if (!stdin.isTTY) {
      let data = ""; stdin.setEncoding("utf8"); stdin.resume();
      stdin.on("data", (d) => { data += d; if (data.includes("\n")) { stdin.pause(); resolve(data.split("\n")[0]); } });
      return;
    }
    stdin.resume(); stdin.setRawMode(true); stdin.setEncoding("utf8");
    let val = "";
    const onData = (ch) => {
      const c = ch.charCodeAt(0);
      if (c === 13 || c === 10 || c === 4) { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); resolve(val); }
      else if (c === 3) { stdout.write("\n"); process.exit(1); }
      else if (c === 127 || c === 8) { if (val) val = val.slice(0, -1); }
      else { val += ch; }
    };
    stdin.on("data", onData);
  });
}

(async () => {
  const username = (process.argv[2] || "").trim();
  if (!username) { console.error("Pemakaian: node src/adduser.js <username> [password]"); process.exit(1); }
  let password = process.argv[3];
  if (!password) {
    password = await promptHidden(`Password untuk "${username}": `);
    const confirm = await promptHidden("Ulangi password : ");
    if (password !== confirm) { console.error("Password tidak sama."); process.exit(1); }
  }
  if (!password || password.length < 4) { console.error("Password minimal 4 karakter."); process.exit(1); }

  const users = auth.loadUsers();
  const { salt, hash } = auth.hashPassword(password);
  const idx = users.findIndex((u) => u.username === username);
  if (idx >= 0) { users[idx] = { username, salt, hash }; console.log(`Akun "${username}" diperbarui.`); }
  else { users.push({ username, salt, hash }); console.log(`Akun "${username}" ditambahkan.`); }
  fs.writeFileSync(auth.USERS_FILE, JSON.stringify({ users }, null, 2) + "\n");
  console.log(`Total akun: ${users.length}  ·  ${auth.USERS_FILE}`);
  process.exit(0);
})();
