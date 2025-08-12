// ./utils/firstDefined,js
/**
 * Returns the first defined (non-null and non-undefined) value in the order: a → b → default.
 * @param {*} a - First value to check.
 * @param {*} b - Second value to check.
 * @param {*} defaultValue - Fallback value if both a and b are null/undefined (default: false).
 * @returns {*} The first defined value among a, b, or defaultValue.
 */
function getFirstDefined(a, b, defaultValue = false) {
  return a !== undefined && a !== null ? a : 
         b !== undefined && b !== null ? b : 
         defaultValue;
}

module.exports =  getFirstDefined;