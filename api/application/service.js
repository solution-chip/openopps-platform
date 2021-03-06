const _ = require ('lodash');
const log = require('log')('app:application:service');
const db = require('../../db');
const dao = require('./dao')(db);

async function findOrCreateApplication (data) {
  var application = (await dao.Application.find('user_id = ? and community_id = ? and cycle_id = ?', [data.userId, data.community.communityId, data.task.cycleId]))[0];
  if (!application) {
    application = await dao.Application.insert({
      userId: data.userId,
      communityId: data.community.communityId,
      cycleId: data.task.cycleId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return application;
}

async function processUnpaidApplication (data, callback) {
  var application = await findOrCreateApplication(data);
  var applicationTasks = await dao.ApplicationTask.find('application_id = ?', application.applicationId);
  if (applicationTasks.length >= 3) {
    callback({ message: 'You have already picked the maximum of 3 programs. ' + 
    'To apply to this internship please remove at least 1 of your already chosen programs from your application.' });
  } else if (_.find(applicationTasks, (applicationTask) => { return applicationTask.taskId == data.task.id; })) {
    callback(null, application.applicationId);
  } else {
    await dao.ApplicationTask.insert({
      applicationId: application.applicationId,
      userId: application.userId,
      taskId: data.task.id,
      sortOrder: applicationTasks.length + 1,
      createdAt: new Date(),
      updateAt: new Date(),
    });
    callback(null, application.applicationId);
  }
}

module.exports = {};

module.exports.apply = async function (userId, taskId, callback) {
  await dao.Task.findOne('id = ?', taskId).then(async task => {
    await dao.Community.findOne('community_id = ?', task.communityId).then(async community => {
      // need a way to determine DoS Unpaid vs VSFS
      if (community.applicationProcess == 'dos') {
        await processUnpaidApplication({ userId: userId, task: task, community: community }, callback);
      } else {
        // We don't know yet how to handle this type of application
        log.error('User attempted to apply to a community task that is not defined.', taskId);
        callback({ message: 'An error occurred attempting to start your application.' });
      }
    }).catch(err => {
      log.error('User attempted to apply to task but the community was not found.', err);
      callback({ message: 'An error occurred attempting to start your application.' });
    });
  }).catch(err => {
    log.error('User attempted to apply to task but none found.', err);
    callback({ message: 'An error occurred attempting to start your application.' });
  });
};

module.exports.findById = async function (applicationId) {
  var application = await dao.Application.find('id = ?', applicationId);
  
};