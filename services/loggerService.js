/**
 * LOGGER SERVICE MODULE
 * 
 * Intercepts console methods (log, error, warn) to store messages in memory
 * while maintaining original console functionality.
 * Provides controlled access to stored logs.
 */

// ======================
// MODULE CONFIGURATION
// ======================
const MAX_LOGS = 500;  // Maximum number of logs to retain in memory
const logs = [];       // Array acting as circular buffer for log storage

// ======================
// CORE LOGGING FUNCTION
// ======================

/**
 * Adds a formatted log entry to the storage buffer
 * @param {string} level - Log severity level ('info', 'error', 'warn')
 * @param {...any} args - Data to be logged (any number/type of arguments)
 */
function addLog(level, ...args) {
  // Convert all arguments to string format
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');

  // Create and store log entry
  logs.push({
    time: new Date().toISOString(),  // ISO-8601 timestamp
    level,                           // Severity level
    message                          // Formatted message
  });

  // Maintain buffer size limit (FIFO eviction)
  if (logs.length > MAX_LOGS) logs.shift();
}

// ======================
// CONSOLE INTERCEPTORS
// ======================

// Store original console methods before overriding
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

/**
 * Intercepted console.log - stores messages as 'info' level
 * @param {...any} args - Arguments to log
 */
console.log = (...args) => {
  addLog('info', ...args);
  originalLog.apply(console, args);  // Maintain original functionality
};

/**
 * Intercepted console.error - stores messages as 'error' level
 * @param {...any} args - Arguments to log
 */
console.error = (...args) => {
  addLog('error', ...args);
  originalError.apply(console, args);
};

/**
 * Intercepted console.warn - stores messages as 'warn' level
 * @param {...any} args - Arguments to log
 */
console.warn = (...args) => {
  addLog('warn', ...args);
  originalWarn.apply(console, args);
};

// ======================
// MODULE EXPORTS
// ======================
module.exports = {
  /**
   * Retrieves all stored logs
   * @returns {Array} Copy of the logs array (oldest first)
   */
  getLogs: () => [...logs]  // Return copy to prevent external modification
};