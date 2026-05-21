// Tiny logger. Lifted out so we can later swap to pino without touching call sites.
// `context` lets us tag a sub-system, e.g. logger.child('mineflayer').

function fmt(level, scope, args) {
  const ts = new Date().toISOString();
  const tag = scope ? `[${scope}]` : '';
  return [`${ts} ${level} ${tag}`.trim(), ...args];
}

function make(scope) {
  return {
    info:  (...a) => console.log  (...fmt('INFO ', scope, a)),
    warn:  (...a) => console.warn (...fmt('WARN ', scope, a)),
    error: (...a) => console.error(...fmt('ERROR', scope, a)),
    debug: (...a) => { if (process.env.DEBUG) console.log(...fmt('DEBUG', scope, a)); },
    child: (sub) => make(scope ? `${scope}/${sub}` : sub),
  };
}

export const logger = make('');
