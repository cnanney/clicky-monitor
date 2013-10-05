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

var CM = CM || {};

CM.build = {
	vars: {
		statsUrl: 'https://clicky.com/user/#/stats/'
	}
};

CM.build.basics = function(){
	CM.log('Fetch basic info');

  var ls = store.get('cm');

  var siteInfo = ls.currentSite.split(','),
    linkURL = this.vars.statsUrl+'?site_id='+siteInfo[0]+'&date='+ls.currentDate,
    spyURL = this.vars.statsUrl+'spy?site_id='+siteInfo[0]+'&date='+ls.currentDate,
    visitorsURL = this.vars.statsUrl+'visitors?site_id='+siteInfo[0]+'&date='+ls.currentDate,
    actionsURL = this.vars.statsUrl+'visitors-actions?site_id='+siteInfo[0]+'&date='+ls.currentDate,
    goalsURL = this.vars.statsUrl+'goals?site_id='+siteInfo[0]+'&date='+ls.currentDate,
    linkText = 'View '+siteInfo[2]+' on Clicky',
    apiString = 'http://api.getclicky.com/api/stats/4?site_id='+siteInfo[0]+'&sitekey='+siteInfo[1]+
      '&date='+ls.currentDate+'&type=visitors-online,visitors,actions,actions-average,time-total-pretty,'+
      'time-average-pretty,bounce-rate,goals&output=json&app=clickychrome';

  $.ajax({
    url: apiString,
    cache: false,
    contentType: "application/json; charset=utf-8",
    dataType: "json",
    success: function(data){
      if (data && data[0]){
        var html = '';
        if (data[0].error){
          html = '<p id="no_site">'+data[0].error+'</p>';
          CM.func.setBadgeText('ERR');
          CM.popup.loadHtml(html);
          console.log(data[0].error);
        }
        else{
          var info = CM.process.basics(data);

          html = '<table class="basics_table" cellpadding="0" cellspacing="0">'+
            '<tr><td class="left visitors"><a class="inline_external external" href="'+visitorsURL+'">Visitors</a>';

          if (ls.currentDate == 'today'){
            html += '<span class="online">'+info.online+' online now</span>';
          }

          html += '</td><td class="value">'+info.visitors+'</td></tr>'+
            '<tr class="alt"><td class="left actions"><a class="inline_external external" href="'+actionsURL+'">Actions</td>'+
            '<td class="value">'+info.actions+'</td></tr>'+
            '<tr><td class="left average_actions">Average actions per visit</td>'+
            '<td class="value">'+info.averageActions+'</td></tr>'+
            '<tr class="alt"><td class="left time">Total time spent</td><td class="value">'+info.time+'</td></tr>'+
            '<tr><td class="left time_average">Average time per visit</td><td class="value">'+info.averageTime+'</td></tr>'+
            '<tr class="alt"><td class="left bounce">Bounce rate</td><td class="value">'+info.bounce+'%</td></tr>'+
            '<tr><td class="left goal"><a class="inline_external external" href="'+goalsURL+'">Goals</td>'+
            '<td class="value">'+info.goals+'</td></tr>'+
            '</table><p id="link_to_clicky"><a class="external" href="'+linkURL+'">'+linkText+'</a></p>';

          // Update badge with new value
          switch (ls.spyType){
            case 'online':
              CM.func.setBadgeNum(info.online);
              break;
            case 'visitors':
              CM.func.setBadgeNum(info.visitors);
              break;
            case 'goals':
              CM.func.setBadgeNum(info.goals);
              break;
          }

        }

				CM.log('Basics HTML built');
        CM.popup.loadHtml(html);
      }
    },
    error: function(XMLHttpRequest, textStatus, errorThrown){
      console.log("Status: "+textStatus+", Error: "+errorThrown);
      console.log(XMLHttpRequest.responseText);
      CM.popup.loadHtml(false);
    }
  });

};

CM.build.visitors = function(){
	CM.log('Fetch visitors list');

  var ls = store.get('cm');

  var siteInfo = ls.currentSite.split(','),
    linkURL = 'http://getclicky.com/stats/visitors?site_id='+siteInfo[0],
    linkText = 'View '+siteInfo[2]+' on Clicky',
    apiString = 'http://api.getclicky.com/api/stats/4?site_id='+siteInfo[0]+
      '&sitekey='+siteInfo[1]+'&type=visitors-list&output=json&limit=5&app=clickychrome';

  $.ajax({
    url: apiString,
    cache: false,
    contentType: "application/json; charset=utf-8",
    dataType: "json",
    success: function(data){
      if (data && data[0]){
        var html = '';
        if (data[0].error){
          html = '<p id="no_site">'+data[0].error+'</p>';
          CM.popup.loadHtml(html);
          console.log(data[0].error);
        }
        else{
          var info = CM.process.visitors(data[0].dates[0].items),
            count = 1, odd;

          if (info.length == 0){
            html += '<h3>No visitors yet today.</h3>';
          }
          else{
            html += '<h3>Last 5 Visitors Today</h3>';
            for (var i = 0, c = info.length; i < c; i++){
              var displayName, displayClass, actionClass;
              if (ls.customName == "yes" && info[i].customName !== false){
                displayName = info[i].customName;
                displayClass = 'visitor_custom';
              }
              else{
                displayName = info[i].ip;
                displayClass = 'visitor_ip';
              }
              actionClass = info[i].goals ? 'visitor_actions visitor_goal' : 'visitor_actions';
              odd = (count % 2 == 0) ? ' alt' : '';
              html += '<div class="visitor'+odd+'"><div class="visitor_info"><span class="visitor_flag"><img src="'+info[i].flagImg+'" alt="'+
                info[i].geoLoc+'" /></span>'+info[i].geoLoc+'<span class="'+displayClass+'"><a class="external" href="'+info[i].ipLink+'">'+
                displayName+'</a></span></div><div class="visitor_session">'+info[i].time+' - '+info[i].timeTotal+
                '<span class="'+actionClass+'">Actions: <a class="external" href="'+info[i].statsUrl+'">'+info[i].actions+'</a></span></div>'+
                '<div class="visitor_landed"><b>Landed:</b> <a class="external" href="'+info[i].contentUrl+'">'+info[i].landed+'</a></div>';

              if (info[i].referrerDomain !== false){
                html += '<div class="visitor_from"><b>From:</b> <a class="external" href="'+info[i].referrerUrl+'">'+info[i].referrerDomain+'</a>';
                if (info[i].referrerSearch !== false){
                  html += ' <span class="visitor_search">'+info[i].referrerSearch+'</span>';
                }
                html += '</div>';
              }
              html += '</div>';
              count++;
            }
          }
          html += '<p id="link_to_clicky"><a class="external" href="'+linkURL+'">'+linkText+'</a></p>';
        }
				CM.log('Visitors HTML built');
        CM.popup.loadHtml(html);
      }
    },
    error: function(XMLHttpRequest, textStatus, errorThrown){
      console.log("Status: "+textStatus+", Error: "+errorThrown);
      console.log(XMLHttpRequest.responseText);
      CM.popup.loadHtml(false);
    }
  });
};

CM.build.charts = function(){
	CM.log('Fetch chart info');

  var ls = store.get('cm');

  var siteInfo = ls.currentSite.split(','),
    apiString,
    linkUrl,
    linkText,
    tmpData = [],
    tmpLabels = [],
    tmpStatURLs = [];

  if (ls.currentChart != 'web-browsers'){

    apiString = 'http://api.getclicky.com/stats/api4?site_id='+siteInfo[0]+'&sitekey='+siteInfo[1]+'&type='+
      ls.currentChart+'&date=previous-30-days&output=json&daily=1&app=clickychrome',
      linkUrl = 'http://getclicky.com/stats/'+ls.currentChart+'?site_id='+siteInfo[0],
      linkText = 'View '+siteInfo[2]+' on Clicky',
      tmpData = [],
      tmpLabels = [];

    $.ajax({
      url: apiString,
      cache: false,
      contentType: "application/json; charset=utf-8",
      dataType: "json",
      success: function(data){
        if (data && data[0]){
          if (data[0].error){
            var html = '<p id="no_site">'+data[0].error+'</p>';
            CM.popup.loadHtml(html);
            console.log(data[0].error);
          }
          else{
            if (data[0].dates[0].items.length > 0){
              for (var i = 0; i < data[0].dates.length; i++){
                tmpData.push(data[0].dates[i].items[0].value);
                tmpLabels.push(data[0].dates[i].date);
              }
              $("#content").html('<div id="chart_area"><div id="chart"></div></div>');
              CM.func.drawChart(tmpData.join(','), tmpLabels.join(','), ls.currentChart);
              $("#chart_area").append('<p id="link_to_clicky"><a class="external" href="'+linkUrl+'">'+linkText+'</a></p>');
              CM.popup.hideLoader();
							CM.log('Graph loaded');
            }
          }
        }
      },
      error: function(XMLHttpRequest, textStatus, errorThrown){
        console.log("Status: "+textStatus+", Error: "+errorThrown);
        console.log(XMLHttpRequest.responseText);
      }
    });
  }

  if (ls.currentChart == 'web-browsers'){

    apiString = 'http://api.getclicky.com/stats/api4?site_id='+siteInfo[0]+'&sitekey='+siteInfo[1]+'&type='+
      ls.currentChart+'&date=last-30-days&output=json&limit=11&app=clickychrome',
      linkUrl = 'http://getclicky.com/stats/visitors-browsers?site_id='+siteInfo[0],
      linkText = 'View '+siteInfo[2]+' on Clicky',
      tmpData = [],
      tmpLabels = [],
      tmpStatURLs = [];

    $.ajax({
      url: apiString,
      cache: false,
      contentType: "application/json; charset=utf-8",
      dataType: "json",
      success: function(data){
        if (data && data[0]){
          if (data[0].error){
            var html = '<p id="no_site">'+data[0].error+'</p>';
            CM.popup.loadHtml(html);
            console.log(data[0].error);
          }
          else{
            if (data[0].dates[0].items.length > 0){
              var len = data[0].dates[0].items.length, i;
              for (i = 0; i < len; i++){
                tmpData.push(Number(data[0].dates[0].items[i].value_percent));
                tmpLabels.push(data[0].dates[0].items[i].title);
                tmpStatURLs.push(data[0].dates[0].items[i].stats_url);
              }

              if (len > 10){
                tmpStatURLs[9] = 'http://getclicky.com/stats/visitors-browsers?site_id='+siteInfo[0]+'&date=last-30-days';
                var pTotal = 0;
                for (i = 0; i < 9; i++){
                  pTotal += tmpData[i];
                }
                tmpData[9] = 100-pTotal;
                tmpLabels[9] = "Others";
              }
              $("#content").html('<div id="chart_area"><div id="chart"></div></div>');
              CM.func.drawPie(tmpData.slice(0, 10), tmpLabels.slice(0, 10), tmpStatURLs.slice(0, 10));
              $("#chart_area").append('<p id="link_to_clicky"><a class="external" href="'+linkUrl+'">'+linkText+'</a></p>');
              $("#chart_area").prepend('<h3>Top Browsers, Last 30 Days</h3>');
              CM.popup.hideLoader();
							CM.log('Pie chart loaded');
            }
          }
        }
      },
      error: function(XMLHttpRequest, textStatus, errorThrown){
        console.log("Status: "+textStatus+", Error: "+errorThrown);
        console.log(XMLHttpRequest.responseText);
      }
    });

  }

};