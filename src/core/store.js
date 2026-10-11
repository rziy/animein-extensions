// JSON store kecil: baca sekali, tulis di-debounce, atomic (tulis tmp lalu rename).
const fs = require("fs");
const path = require("path");

class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.data = fallback;
    this.dirty = false;
    this.timer = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      this.data = { ...fallback, ...parsed };
    } catch { /* belum ada / rusak: pakai fallback */ }
  }

  touch(delay = 5000) {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), delay);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.error("[AniPresence] Gagal menyimpan", this.file, error.message);
    }
  }
}

module.exports = { JsonStore };
