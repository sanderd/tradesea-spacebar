const PREFIX = '%c[TS-Spacebar]';
const STYLE = 'color:#ff00ff;font-weight:bold';
const DEBUG = true;
const log = (...a) => DEBUG && console.log(PREFIX, STYLE, ...a);
const warn = (...a) => console.warn(PREFIX, 'color:#FFA500;font-weight:bold', ...a);
const err = (...a) => console.error(PREFIX, 'color:#FF4444;font-weight:bold', ...a);

export { log, warn, err };
