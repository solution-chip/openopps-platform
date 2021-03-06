const jwt = require('jsonwebtoken');
const passport = require('koa-passport');
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const jwksRsa = require('jwks-rsa');
const log = require('log')('app:passport');
const db = require('../../db');
const dao = require('./dao')(db);
const bcrypt = require('bcryptjs');
const _ = require('lodash');
const Profile = require('./profile');

const localStrategyOptions = {
  usernameField: 'identifier',
  passwordField: 'password',
};

function validatePassword (password, hash) {
  return bcrypt.compareSync(password, hash);
}

async function fetchUser (id) {
  return await dao.User.query(dao.query.user, id, dao.options.user).then(async results => {
    var user = results[0];
    if (user) {
      user.isOwner = true;
      user.isCommunityAdmin = (await dao.CommunityUser.find('user_id = ? and is_manager = ?', user.id, true)).length > 0;
      user.badges = await dao.Badge.find('"user" = ?', user.id, dao.options.badge);
      var GetCommunities = require('../opportunity/service').getCommunities;
      user.communities = await GetCommunities(user.id);
      user = dao.clean.user(user);
    }
    return user;
  }).catch(err => {
    log.info('Fetch user error', err);
    return null;
  });
}

async function fetchPassport (user, protocol) {
  return (await dao.Passport.find('"user" = ? and protocol = ? and "deletedAt" is null', user, protocol))[0];
}

async function userFound (user, tokenset, done) {
  if (user.disabled) {
    done({ message: 'Not authorized' });
  } else {
    user.access_token = tokenset.access_token,
    user.id_token = tokenset.id_token,
    done(null, user);
  }
}

function processFederalEmployeeLogin (tokenset, done) {
  dao.User.findOne('linked_id = ? or (linked_id = \'\' and username = ?)', tokenset.claims.sub, tokenset.claims['usaj:governmentURI']).then(user => {
    userFound(user, tokenset, done);
  }).catch(async () => {
    var account = await dao.AccountStaging.findOne('linked_id = ?', tokenset.claims.sub).catch(() => {
      return {
        linkedId: tokenset.claims.sub,
        governmentUri: tokenset.claims['usaj:governmentURI'],
      };
    });
    done(null, _.extend(account, {
      type: 'staging',
      access_token: tokenset.access_token,
      id_token: tokenset.id_token,
    }));
  });
}

function processStudentLogin (tokenset, done) {
  //done({ message: 'Not implemented', data: { documentId: tokenset.claims.sub }});
  dao.User.findOne('linked_id = ? ', tokenset.claims.sub).then(user => {
    userFound(user, tokenset, done);
  }).catch(async () => {
    // create new account
    await Profile.get(tokenset).then(async (profile) => {
      var user = {
        name: _.filter([profile.GivenName, profile.MiddleName, profile.LastName], _.identity).join(' '),
        givenName: profile.GivenName,
        middleName: profile.MiddleName,
        lastName: profile.LastName,
        linkedId: tokenset.claims.sub,
        username: profile.URI,
        hiringPath: 'student',
        createdAt: new Date(),
        updatedAt: new Date(),
        disabled: false,
        isAdmin: false,
      };
      await dao.User.insert(user).then(user => {
        done(null, _.extend(user, {
          access_token: tokenset.access_token,
          id_token: tokenset.id_token,
        }));
      });
    });
  });
}

passport.serializeUser(function (user, done) {
  done(null, {
    id: user.id,
    access_token: user.access_token,
    id_token: user.id_token,
  });
});

passport.deserializeUser(async function (userObj, done) {
  var user = await fetchUser(userObj.id);
  user.access_token = userObj.access_token,
  user.id_token = userObj.id_token,
  done(null, user);
});

passport.use(new LocalStrategy(localStrategyOptions, async (username, password, done) => {
  var maxAttempts = openopps.auth.local.passwordAttempts;
  log.info('local login attempt for:', username);
  await dao.User.findOne('username = ?', username.toLowerCase().trim()).then(async (user) => {
    if (maxAttempts > 0 && user.passwordAttempts >= maxAttempts) {
      log.info('max passwordAttempts (1)', user.passwordAttempts, maxAttempts);
      done({ message: 'locked', data: { userId: user.id } }, false);
    } else {
      var passport = await fetchPassport(user.id, 'local');
      if (passport) {
        if (!validatePassword(password, passport.password)) {
          user.passwordAttempts++;
          dao.User.update(user).then(() => {
            if (maxAttempts > 0 && user.passwordAttempts >= maxAttempts) {
              log.info('max passwordAttempts (2)', user.passwordAttempts, maxAttempts);
              done({ message: 'locked', data: { userId: user.id } }, false);
            } else {
              log.info('Error.Passport.Password.Wrong');
              done({ data: { userId: user.id } }, false);
            }
          }).catch(err => {
            done(err, false);
          });
        } else {
          await dao.User.update({
            id: user.id,
            passwordAttempts: 0,
            updatedAt: new Date(),
          }).catch(err => {
            log.info('Error resetting password attempts');
          });
          done(null, user);
        }
      } else {
        log.info('Error.Passport.Password.NotSet');
        done({ data: { userId: user.id } }, false);
      }
    }
  }).catch(err => {
    log.info('Error.Passport.Username.NotFound', username, err);
    done({ message: 'Username not found.' }, false);
  });
}));

if (openopps.auth.oidc) {
  const { Strategy } = require('openid-client');
  var OpenIDStrategyOptions = {
    client: openopps.auth.oidc,
    params: {
      redirect_uri: openopps.httpProtocol + '://' + openopps.hostName + '/api/auth/oidc/callback',
      scope: 'openid profile email phone address opendataread',
    },
  };
  passport.use('oidc', new Strategy(OpenIDStrategyOptions, (tokenset, userinfo, done) => {
    if (tokenset.claims['usaj:hiringPath'] == 'fed' && tokenset.claims['usaj:governmentURI']) {
      processFederalEmployeeLogin(tokenset, done);
    } else if (tokenset.claims['usaj:hiringPath'] == 'student') {
      processStudentLogin(tokenset, done);
    } else {
      done({ message: 'Not authorized', data: { documentId: tokenset.claims.sub } });
    }
  }));

  const handleSigningKeyError = (err, cb) => {
    // If we didn't find a match, can't provide a key.
    if (err && err.name === 'SigningKeyNotFoundError') {
      return cb(null);
    }

    // If an error occured like rate limiting or HTTP issue, we'll bubble up the error.
    if (err) {
      return cb(err);
    }
  };

  var passportJwtSecret = function (options) {
    if (options === null || options === undefined) {
      throw new Error('An options object must be provided when initializing passportJwtSecret');
    }

    const client = new jwksRsa(options);
    const onError = options.handleSigningKeyError || handleSigningKeyError;

    return function secretProvider (req, rawJwtToken, cb) {
      const decoded = jwt.decode(rawJwtToken, { complete: true });

      // Only RS256 is supported.
      if (!decoded || !decoded.header || decoded.header.alg !== 'RS256') {
        return cb(null, null);
      }

      client.getSigningKey(decoded.header.kid, (err, key) => {
        if (err) {
          return onError(err, (newError) => cb(newError, null));
        }

        // Provide the key.
        return cb(null, key.publicKey || key.rsaPublicKey);
      });
    };
  };

  var opts = {};
  opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();
  opts.secretOrKeyProvider = passportJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: openopps.auth.oidc.issuer.jwks_uri,
    strictSsl: false,
  });
  opts.issuer = openopps.auth.oidc.issuer.issuer;
  //opts.audience = 'openopps';
  passport.use(new JwtStrategy(opts, (jwt_payload, done) => {
    try {
      // dao.User.findById
      dao.User.findOne('linked_id = ?', jwt_payload.sub).then(user => {
        if (user) {
          console.log('user found', user);
          return done(null, user);
        } else {
          return done(new Error('User not found'), null);
        }
      });
    } catch (err) {
      return done(err, null);
    }
  }),
  );
}
