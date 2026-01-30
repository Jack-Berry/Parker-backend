// ---------------------------------------
// Logging utilities with timestamps
// ---------------------------------------
function getTimestamp() {
  return new Date().toISOString();
}

function logWithTimestamp(message, meta) {
  const ts = getTimestamp();
  if (meta) {
    try {
      console.log(ts, message, JSON.stringify(meta, null, 2));
    } catch {
      console.log(ts, message, meta);
    }
  } else {
    console.log(ts, message);
  }
}

function logErrorWithTimestamp(message, meta) {
  const ts = getTimestamp();
  if (meta) {
    try {
      console.error(ts, message, JSON.stringify(meta, null, 2));
    } catch {
      console.error(ts, message, meta);
    }
  } else {
    console.error(ts, message);
  }
}

// ---------------------------------------
// Date formatting utilities
// ---------------------------------------
function parseIsoDateOnly(d) {
  return d.toISOString().split("T")[0];
}

function formatDdMmYyyy(dateString) {
  const d = new Date(dateString);
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
}

module.exports = {
  getTimestamp,
  logWithTimestamp,
  logErrorWithTimestamp,
  parseIsoDateOnly,
  formatDdMmYyyy,
};
