/**
 * ClickyChrome
 * ------------
 * A Chrome extension for Clicky Web Analytics
 * http://getclicky.com
 *
 * Copyright (c) 2010 Chris Nanney
 * http://cnanney.com/clickychrome
 * http://bitbucket.org/cnanney/clickychrome/
 *
 * Licensed under MIT
 * http://www.opensource.org/licenses/mit-license.php
 *
 * Version: 2.0
 * Released: September 8, 2010
 */

var ClickyChrome = ClickyChrome || {};

ClickyChrome.Process = {};

/**
 * Processes API basics info
 *
 * @param {array} data
 *		API response array
 *
 * @return object
 */
ClickyChrome.Process.basics = function(data){
	var info = {
		online: ClickyChrome.Functions.addCommas(data[0].dates[0].items[0].value),
		visitors: ClickyChrome.Functions.addCommas(data[1].dates[0].items[0].value),
		actions: ClickyChrome.Functions.addCommas(data[2].dates[0].items[0].value),
		averageActions: ClickyChrome.Functions.addCommas(data[3].dates[0].items[0].value),
		time: data[4].dates[0].items[0].value,
		averageTime: data[5].dates[0].items[0].value,
		bounce: data[6].dates[0].items[0].value,
		goals: function(data){
			var goalCount = 0;
			if (typeof (data[7].dates[0].items[0]) == 'object'){
				for (var i = 0; i < data[7].dates[0].items.length; i++){
					goalCount += parseFloat(data[7].dates[0].items[i].value);
				}
			}
			return ClickyChrome.Functions.addCommas(goalCount);
		}(data)
	};
	return info;
};

/**
 * Processes API visitor list info
 *
 * @param {array} data
 *		API response array
 *
 *	@return array
 */
ClickyChrome.Process.visitors = function(data){
	var info = [],
	siteInfo = localStorage["clickychrome_currentSite"].split(',');
	for (var i = 0, count = data.length; i < count; i++){
		info[i] = {
			ipLink: 'http://getclicky.com/stats/visitors?site_id=' + siteInfo[0] + '&ip_address=' + data[i].ip_address,
			contentUrl: function(data){
				var urlParts = data.landing_page.split('/'),
				contentUrl = 'http://getclicky.com/stats/visitors?site_id=' + siteInfo[0] + '&href=';
				for (var j = 3, c = urlParts.length; j < c; j++){
					contentUrl += '/' + urlParts[j];
				}
				return contentUrl;
			}(data[i]),
			flagImg: typeof data[i].country_code == "undefined" ? "/images/icon_world.png" : 'http://static.getclicky.com/media/flags/' + data[i].country_code + '.gif',
			geoLoc: typeof data[i].geolocation == "undefined" ? "Planet Earth" : data[i].geolocation,
			customName: data[i].custom && data[i].custom.username ? data[i].custom.username : false,
			goals: data[i].goals && data[i].goals.completed ? true : false,
			ip: data[i].ip_address,
			time: data[i].time_pretty,
			timeTotal: ClickyChrome.Functions.abvTime(data[i].time_total),
			statsUrl: data[i].stats_url,
			actions: ClickyChrome.Functions.addCommas(data[i].actions),
			landed: function(data){
				var qs = data.landing_page.indexOf('?'),
				lp = (qs == -1) ? data.landing_page : data.landing_page.substring(0, qs);
				return lp;
			}(data[i]),
			referrerDomain: typeof data[i].referrer_domain == "undefined" ? false : data[i].referrer_domain,
			referrerUrl: typeof data[i].referrer_url == "undefined" ? false : data[i].referrer_url,
			referrerSearch: typeof data[i].referrer_search == "undefined" ? false : data[i].referrer_search
		};
	}
	return info;
};

/**
 * Processes API goal info for notifications
 *
 * @param {array} data
 *		API response array
 *
 * @return object
 */
ClickyChrome.Process.goals = function(data){
	var log = chrome.extension.getBackgroundPage().ClickyChrome.Background.vars.goalLog,
	newIds = {},
	count = data.length;

	for (var i = 0; i < count; i++){
		newIds[data[i].session_id] = {
			cc: data[i].country_code || 'none',
			ip: data[i].ip_address,
			visitor: data[i].custom && data[i].custom.username ? data[i].custom.username : data[i].ip_address,
			custom: data[i].custom && data[i].custom.username ? 1 : 0,
			geo: data[i].geolocation || 'Planet Earth',
			url: data[i].stats_url,
			time: data[i].time_pretty,
			goals: data[i].goals.completed.join(', '),
			value: data[i].goals.revenue,
			id: data[i].session_id,
			timestamp: data[i].time
		};
	}
	
	// Delete repeats, store new
	for(var id in newIds){
		if(newIds.hasOwnProperty(id)){
			if (log.hasOwnProperty(id)){
				if (newIds[id].goals != log[id].goals){
					log[id].goals = newIds[id].goals;
				}
				else{
					delete newIds[id];
				}
			}
			else{
				log[id] = newIds[id];
			}
		}
	}
	
	chrome.extension.getBackgroundPage().ClickyChrome.Background.updateGoalLog(log);
	return ClickyChrome.Functions.objectSize(newIds) != 0 ? newIds : false;
};