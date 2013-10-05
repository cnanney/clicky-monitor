/**
 * Clicky Monitor
 * --------------
 * A Chrome extension for Clicky Web Analytics
 *
 * https://clicky.com
 * https://github.com/cnanney/clicky-monitor
 *
 * Licensed under MIT
 * http://www.opensource.org/licenses/mit-license.php
 */

var CM = {
	debug: true,
	extend: function(obj){
		return _.isObject(obj) ? store.set('cm', $.extend(store.get('cm'), obj)) : false;
	},
	get: function(prop){
		return _.isUndefined(prop) ? store.get('cm') : store.get('cm')[prop];
	},
	set: function(prop, val){
		if (_.isString(prop) && !_.isUndefined(val)){
			var obj = {};
			obj[prop] = val;
			return this.extend(obj);
		}
		return false;
	}
};

(function(){
	CM.log = CM.debug ? Function.prototype.bind.call(console.log, console) : function(){};
})();