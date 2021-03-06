/**
 * app.js
 *
 * To start the server, run: `node app.js`.
 *
 * `node app.js --silent --port=80 --prod`
 */

// Ensure we're in the project directory, so relative paths work as expected
process.chdir(__dirname);

require('app-module-path').addPath('lib/');
const log = require('log')('app');

log.info('start');

(async function () {
  // Ensure all our dependencies can be located:
  try {
    await require('./app/initialize-on-startup')();
    require('./app/openopps')();
  } catch (e) {
    log.error('Error starting app\n');
    log.error(e);
    if(e.message.match('Cannot find module')) {
      var module = e.message.split('Cannot find module ')[1];
      log.error('To fix the error please try running `npm install ' + module.replace(/'/g, '') + '`');
    }
    return;
  }
})();
