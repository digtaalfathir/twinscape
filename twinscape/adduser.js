#!/usr/bin/env node
/**
 * Tambah / perbarui akun login Twinscape.
 *   node v2/adduser.js <username>            → diminta password (tersembunyi)
 *   node v2/adduser.js <username> <password> → non-interaktif
 * Password di-hash scrypt lalu disimpan ke v2/users.json. Hapus akun = edit file itu.
 */
const fs = require("fs");
const auth = require("./auth");

function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin, stdout = process.stdout;
    stdout.write(question);
    if (!stdin.isTTY) {                    // dijalankan lewat pipe → baca 1 baris biasa
      let data = ""; stdin.setEncoding("utf8"); stdin.resume();
      stdin.on("data", (d) => { data += d; if (data.includes("\n")) { stdin.pause(); resolve(data.split("\n")[0]); } });
      return;
    }
    stdin.resume(); stdin.setRawMode(true); stdin.setEncoding("utf8");
    let val = "";
    const onData = (ch) => {
      const c = ch.charCodeAt(0);
      if (c === 13 || c === 10 || c === 4) {          // Enter (CR/LF) atau Ctrl-D → selesai
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); resolve(val);
      } else if (c === 3) {                           // Ctrl-C → batal
        stdout.write("\n"); process.exit(1);
      } else if (c === 127 || c === 8) {              // Backspace / Delete
        if (val) val = val.slice(0, -1);
      } else {
        val += ch;
      }
    };
    stdin.on("data", onData);
  });
}

(async () => {
  const args = process.argv.slice(2);
  let role = null;
  const rf = args.indexOf("--role");
  if (rf >= 0) { role = (args[rf + 1] || "").trim(); args.splice(rf, 2); }   // --role <nama> (RBAC Fase 4)
  let locs = null;
  const lf = args.indexOf("--loc");   // --loc sugity  ·  --loc jmp,sugity  ·  --loc *  (akses lokasi; absen = semua)
  if (lf >= 0) { const v = (args[lf + 1] || "").trim(); locs = v === "*" ? "*" : v.split(",").map((s) => s.trim()).filter(Boolean); args.splice(lf, 2); }
  const username = (args[0] || "").trim();
  if (!username) { console.error("Pemakaian: node adduser.js <username> [password] [--role <role>] [--loc <id,id|*>]"); process.exit(1); }
  let password = args[1];
  if (!password) {
    password = await promptHidden(`Password untuk "${username}": `);
    const confirm = await promptHidden("Ulangi password : ");
    if (password !== confirm) { console.error("Password tidak sama."); process.exit(1); }
  }
  if (!password || password.length < 4) { console.error("Password minimal 4 karakter."); process.exit(1); }

  const users = auth.loadUsers();
  const { salt, hash } = auth.hashPassword(password);
  const idx = users.findIndex((u) => u.username === username);
  const finalRole = role || (idx >= 0 ? users[idx].role : undefined);      // update password tak menghapus role lama
  const finalLocs = locs != null ? locs : (idx >= 0 ? users[idx].locations : undefined);   // idem utk akses lokasi
  const rec = { username, salt, hash };
  if (finalRole) rec.role = finalRole;                                     // kosong → server pakai default 'viewer'
  if (finalLocs != null) rec.locations = finalLocs;                        // absen → semua lokasi; array → hanya yg terdaftar; "*" → semua
  const extra = [finalRole ? `role: ${finalRole}` : null, finalLocs != null ? `loc: ${finalLocs === "*" ? "*" : finalLocs.join(",") || "(none)"}` : null].filter(Boolean).join(", ");
  if (idx >= 0) { users[idx] = rec; console.log(`Akun "${username}" diperbarui${extra ? ` (${extra})` : ""}.`); }
  else { users.push(rec); console.log(`Akun "${username}" ditambahkan${extra ? ` (${extra})` : ""}.`); }
  fs.writeFileSync(auth.USERS_FILE, JSON.stringify({ users }, null, 2) + "\n");
  console.log(`Total akun: ${users.length}  ·  ${auth.USERS_FILE}`);
  process.exit(0);
})();
