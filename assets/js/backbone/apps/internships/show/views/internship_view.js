var $ = require('jquery');
var _ = require('underscore');
var Backbone = require('backbone');
var marked = require('marked');

var BaseView = require('../../../../base/base_view');
var UIConfig = require('../../../../config/ui.json');
var ModalComponent = require('../../../../components/modal');

var AlertTemplate = require('../../../../components/alert_template.html');
var InternshipShowTemplate = require('../templates/internship_view.html');

var InternshipView = BaseView.extend({
  events: {
    'click #apply'  : 'apply',
  },

  initialize: function (options) {
    this.options = options;
  },

  render: function () {
    this.data = {
      user: window.cache.currentUser,
      model: this.model.toJSON(),
      madlibTags: organizeTags(this.model.toJSON().tags),
    };

    _.each(['details', 'about'], function (part) {
      if(this.data.model[part]) {
        this.data.model[part + 'Html'] = marked(this.data.model[part]);
      }
    }.bind(this));

    var compiledTemplate = _.template(InternshipShowTemplate)(this.data);
    this.$el.html(compiledTemplate);
    this.$el.localize();
    $('#search-results-loading').hide();
    
    return this;
  },

});

module.exports = InternshipView;