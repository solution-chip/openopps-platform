var assert = require('assert');
//var request = require('request');
var app = require('./helpers/app');

describe('Starting sails server with lift', function() {
  before(function() {
  });

  after(function() {
  });

  describe('in midas directory', function() {
    it('should start server without error', function(done) {
      app.spawn(function (sailsServer, data) {
        assert.notEqual(sailsServer, null, data);
        app.kill(sailsServer, function() {
          done();
        });
      });
    });
  });
});
