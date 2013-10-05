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

CM.process = {};

/**
 * Processes API basics info
 *
 * @param {array} data
 *    API response array
 *
 * @return object
 */
CM.process.basics = function(data){
  return {
    online: CM.func.addCommas(data[0].dates[0].items[0].value),
    visitors: CM.func.addCommas(data[1].dates[0].items[0].value),
    actions: CM.func.addCommas(data[2].dates[0].items[0].value),
    averageActions: CM.func.addCommas(data[3].dates[0].items[0].value),
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
      return CM.func.addCommas(goalCount);
    }(data)
  };
};

/**
 * Processes API visitor list info
 *
 * @param data API response array
 * @returns {Array}
 */
CM.process.visitors = function(data){
  var info = [],
    siteInfo = CM.get('currentSite').split(',');
  for (var i = 0, count = data.length; i < count; i++){
    info[i] = {
      ipLink: 'http://getclicky.com/stats/visitors?site_id='+siteInfo[0]+'&ip_address='+data[i].ip_address,
      contentUrl: function(data){
        var urlParts = data.landing_page.split('/'),
          contentUrl = 'http://getclicky.com/stats/visitors?site_id='+siteInfo[0]+'&href=';
        for (var j = 3, c = urlParts.length; j < c; j++){
          contentUrl += '/'+urlParts[j];
        }
        return contentUrl;
      }(data[i]),
      flagImg: typeof data[i].country_code == "undefined" ?
        "/images/icon_world.png" :
        'http://static.getclicky.com/media/flags/'+data[i].country_code+'.gif',
      geoLoc: typeof data[i].geolocation == "undefined" ? "Planet Earth" : data[i].geolocation,
      customName: data[i].custom && data[i].custom.username ? data[i].custom.username : false,
      goals: data[i].goals && data[i].goals.completed ? true : false,
      ip: data[i].ip_address,
      time: data[i].time_pretty,
      timeTotal: CM.func.abvTime(data[i].time_total),
      statsUrl: data[i].stats_url,
      actions: CM.func.addCommas(data[i].actions),
      landed: function(data){
        var qs = data.landing_page.indexOf('?');
        return qs == -1 ? data.landing_page : data.landing_page.substring(0, qs);
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
 *    API response array
 *
 * @return object
 */
CM.process.goals = function(data){
  var log = chrome.extension.getBackgroundPage().CM.bg.vars.goalLog,
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
  for (var id in newIds){
    if (newIds.hasOwnProperty(id)){
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

  chrome.extension.getBackgroundPage().CM.bg.updateGoalLog(log);
  return CM.func.objectSize(newIds) != 0 ? newIds : false;
};