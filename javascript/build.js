/**
 * Clicky Monitor
 * --------------
 * A Chrome extension for Clicky Web Analytics
 * http://getclicky.com
 *
 * Copyright (c) 2010 Chris Nanney
 * http://cnanney.com/clickymonitor/
 * http://bitbucket.org/cnanney/clickychrome/
 *
 * Licensed under MIT
 * http://www.opensource.org/licenses/mit-license.php
 */

var ClickyChrome = ClickyChrome || {};

ClickyChrome.Build = {};

ClickyChrome.Build.debug = chrome.extension.getBackgroundPage().ClickyChrome.Background.debug;

ClickyChrome.Build.basics = function(){
	if (ClickyChrome.Build.debug) console.log('Fetch basic info');

	var siteInfo = localStorage["clickychrome_currentSite"].split(','),
	linkURL = 'http://getclicky.com/stats/home?site_id=' + siteInfo[0] + '&date=' + localStorage["clickychrome_currentDate"],
	spyURL = 'http://getclicky.com/stats/spy?site_id=' + siteInfo[0] + '&date=' + localStorage["clickychrome_currentDate"],
	visitorsURL = 'http://getclicky.com/stats/visitors?site_id=' + siteInfo[0] + '&date=' + localStorage["clickychrome_currentDate"],
	actionsURL = 'http://getclicky.com/stats/visitors-actions?site_id=' + siteInfo[0] + '&date=' + localStorage["clickychrome_currentDate"],
	goalsURL = 'http://getclicky.com/stats/goals?site_id=' + siteInfo[0] + '&date=' + localStorage["clickychrome_currentDate"],
	linkText = 'View ' + siteInfo[2] + ' on Clicky',
	apiString = 'http://api.getclicky.com/api/stats/4?site_id=' + siteInfo[0] + '&sitekey=' + siteInfo[1] +
		'&date=' + localStorage["clickychrome_currentDate"] +'&type=visitors-online,visitors,actions,actions-average,time-total-pretty,' +
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
					html = '<p id="no_site">' + data[0].error + '</p>';
					ClickyChrome.Functions.setBadgeText('ERR');
					ClickyChrome.Popup.loadHtml(html);
					console.log(data[0].error);
				}
				else{
					var info = ClickyChrome.Process.basics(data);

					html = '<table class="basics_table" cellpadding="0" cellspacing="0">' +
					'<tr><td class="left visitors"><a class="inline_external external" href="' + visitorsURL + '">Visitors</a>';

					if (localStorage["clickychrome_currentDate"] == 'today'){
						html += '<span class="online">' + info.online + ' online now</span>';
					}

					html += '</td><td class="value">' + info.visitors + '</td></tr>' +
					'<tr class="alt"><td class="left actions"><a class="inline_external external" href="' + actionsURL + '">Actions</td>' +
					'<td class="value">' + info.actions + '</td></tr>' +
					'<tr><td class="left average_actions">Average actions per visit</td>' +
					'<td class="value">' + info.averageActions + '</td></tr>' +
					'<tr class="alt"><td class="left time">Total time spent</td><td class="value">' + info.time + '</td></tr>' +
					'<tr><td class="left time_average">Average time per visit</td><td class="value">' + info.averageTime + '</td></tr>' +
					'<tr class="alt"><td class="left bounce">Bounce rate</td><td class="value">' + info.bounce + '%</td></tr>' +
					'<tr><td class="left goal"><a class="inline_external external" href="' + goalsURL + '">Goals</td>' +
					'<td class="value">' + info.goals + '</td></tr>' +
					'</table><p id="link_to_clicky"><a class="external" href="' + linkURL + '">' + linkText + '</a></p>';

					// Update badge with new value
					switch (localStorage["clickychrome_spyType"]){
						case 'online':
							ClickyChrome.Functions.setBadgeNum(info.online);
							break;
						case 'visitors':
							ClickyChrome.Functions.setBadgeNum(info.visitors);
							break;
						case 'goals':
							ClickyChrome.Functions.setBadgeNum(info.goals);
							break;
					}

				}

				if (ClickyChrome.Build.debug) console.log('Basics HTML built: ' + html);
				ClickyChrome.Popup.loadHtml(html);
			}
		},
		error: function (XMLHttpRequest, textStatus, errorThrown) {
			console.log("Status: "+textStatus+", Error: "+errorThrown);
			console.log(XMLHttpRequest.responseText);
			ClickyChrome.Popup.loadHtml(false);
		}
	});
	
};

ClickyChrome.Build.visitors = function(){
	if (ClickyChrome.Build.debug) console.log('Fetch visitors list');

	var siteInfo = localStorage["clickychrome_currentSite"].split(','),
	linkURL = 'http://getclicky.com/stats/visitors?site_id=' + siteInfo[0],
	linkText = 'View ' + siteInfo[2] + ' on Clicky',
	apiString = 'http://api.getclicky.com/api/stats/4?site_id=' + siteInfo[0] +
		'&sitekey=' + siteInfo[1] + '&type=visitors-list&output=json&limit=5&app=clickychrome';

	$.ajax({
		url: apiString,
		cache: false,
		contentType: "application/json; charset=utf-8",
		dataType: "json",
		success: function(data){
			if (data && data[0]){
				var html = '';
				if (data[0].error){
					html = '<p id="no_site">' + data[0].error + '</p>';
					ClickyChrome.Popup.loadHtml(html);
					console.log(data[0].error);
				}
				else{
					var info = ClickyChrome.Process.visitors(data[0].dates[0].items),
					count = 1, odd;

					if (info.length == 0){
						html += '<h3>No visitors yet today.</h3>';
					}
					else{
						html += '<h3>Last 5 Visitors Today</h3>';
						for (var i = 0, c = info.length; i < c; i++){
							var displayName, displayClass, actionClass;
							if (localStorage["clickychrome_customName"] == "yes" && info[i].customName !== false){
								displayName = info[i].customName;
								displayClass = 'visitor_custom';
							}
							else{
								displayName = info[i].ip;
								displayClass = 'visitor_ip';
							}
							actionClass = info[i].goals ? 'visitor_actions visitor_goal' : 'visitor_actions';
							odd = (count % 2 == 0) ? ' alt' : '';
							html += '<div class="visitor' + odd + '"><div class="visitor_info"><span class="visitor_flag"><img src="' + info[i].flagImg + '" alt="' +
							info[i].geoLoc + '" /></span>' + info[i].geoLoc + '<span class="' + displayClass + '"><a class="external" href="' + info[i].ipLink + '">' +
							displayName + '</a></span></div><div class="visitor_session">' + info[i].time + ' - ' + info[i].timeTotal +
							'<span class="' + actionClass + '">Actions: <a class="external" href="' + info[i].statsUrl + '">' + info[i].actions + '</a></span></div>' +
							'<div class="visitor_landed"><b>Landed:</b> <a class="external" href="' + info[i].contentUrl + '">' + info[i].landed + '</a></div>';

							if (info[i].referrerDomain !== false){
								html += '<div class="visitor_from"><b>From:</b> <a class="external" href="' + info[i].referrerUrl + '">' + info[i].referrerDomain + '</a>';
								if (info[i].referrerSearch !== false){
									html += ' <span class="visitor_search">' + info[i].referrerSearch + '</span>';
								}
								html += '</div>';
							}
							html += '</div>';
							count++;
						}
					}
					html += '<p id="link_to_clicky"><a class="external" href="' + linkURL + '">' + linkText + '</a></p>';
				}
				if (ClickyChrome.Build.debug) console.log('Visitors HTML built: ' + html);
				ClickyChrome.Popup.loadHtml(html);
			}
		},
		error: function (XMLHttpRequest, textStatus, errorThrown) {
			console.log("Status: "+textStatus+", Error: "+errorThrown);
			console.log(XMLHttpRequest.responseText);
			ClickyChrome.Popup.loadHtml(false);
		}
	});
};

ClickyChrome.Build.charts = function(){
	if (ClickyChrome.Build.debug) console.log('Fetch chart info');
	var siteInfo = localStorage["clickychrome_currentSite"].split(','),
	apiString,
	linkUrl,
	linkText,
	tmpData = [],
	tmpLabels = [],
	tmpStatURLs = [];

	if (localStorage["clickychrome_currentChart"] != 'web-browsers'){

	 	apiString = 'http://api.getclicky.com/stats/api4?site_id=' + siteInfo[0] + '&sitekey=' + siteInfo[1] + '&type=' +
		 	localStorage["clickychrome_currentChart"] + '&date=previous-30-days&output=json&daily=1&app=clickychrome',
		linkUrl = 'http://getclicky.com/stats/' + localStorage["clickychrome_currentChart"] + '?site_id=' + siteInfo[0],
		linkText = 'View ' + siteInfo[2] + ' on Clicky',
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
						var html = '<p id="no_site">' + data[0].error + '</p>';
						ClickyChrome.Popup.loadHtml(html);
						console.log(data[0].error);
					}
					else{
						if (data[0].dates[0].items.length > 0){
							for (var i = 0; i < data[0].dates.length; i++){
								tmpData.push(data[0].dates[i].items[0].value);
								tmpLabels.push(data[0].dates[i].date);
							}
							$("#content").html('<div id="chart_area"><div id="chart"></div></div>');
							ClickyChrome.Functions.drawChart(tmpData.join(','), tmpLabels.join(','), localStorage["clickychrome_currentChart"]);
							$("#chart_area").append('<p id="link_to_clicky"><a class="external" href="' + linkUrl + '">' + linkText + '</a></p>');
							ClickyChrome.Popup.hideLoader();
							if (ClickyChrome.Build.debug) console.log('Graph loaded');
						}
					}
				}
			},
			error: function (XMLHttpRequest, textStatus, errorThrown) {
				console.log("Status: "+textStatus+", Error: "+errorThrown);
				console.log(XMLHttpRequest.responseText);
			}
		});
	}

	if (localStorage["clickychrome_currentChart"] == 'web-browsers'){

	 	apiString = 'http://api.getclicky.com/stats/api4?site_id=' + siteInfo[0] + '&sitekey=' + siteInfo[1] + '&type=' +
		 	localStorage["clickychrome_currentChart"] + '&date=last-30-days&output=json&limit=11&app=clickychrome',
		linkUrl = 'http://getclicky.com/stats/visitors-browsers?site_id=' + siteInfo[0],
		linkText = 'View ' + siteInfo[2] + ' on Clicky',
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
						var html = '<p id="no_site">' + data[0].error + '</p>';
						ClickyChrome.Popup.loadHtml(html);
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
								tmpStatURLs[9] = 'http://getclicky.com/stats/visitors-browsers?site_id=' + siteInfo[0] + '&date=last-30-days';
								var pTotal = 0;
								for (i = 0; i < 9; i++){
									pTotal += tmpData[i];
								}
								tmpData[9] = 100 - pTotal;
								tmpLabels[9] = "Others";
							}
							$("#content").html('<div id="chart_area"><div id="chart"></div></div>');
							ClickyChrome.Functions.drawPie(tmpData.slice(0,10), tmpLabels.slice(0,10), tmpStatURLs.slice(0,10));
							$("#chart_area").append('<p id="link_to_clicky"><a class="external" href="' + linkUrl + '">' + linkText + '</a></p>');
							$("#chart_area").prepend('<h3>Top Browsers, Last 30 Days</h3>');
							ClickyChrome.Popup.hideLoader();
							if (ClickyChrome.Build.debug) console.log('Pie chart loaded');
						}
					}
				}
			},
			error: function (XMLHttpRequest, textStatus, errorThrown) {
				console.log("Status: "+textStatus+", Error: "+errorThrown);
				console.log(XMLHttpRequest.responseText);
			}
		});

	}

};