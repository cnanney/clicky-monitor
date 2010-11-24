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

ClickyChrome.Notifications = {};

ClickyChrome.Notifications.debug = chrome.extension.getBackgroundPage().ClickyChrome.Background.debug;

$(function(){
	// Stop notification from closing if mouseover it
	$(".notification").live("mouseenter", function(){
		chrome.extension.getBackgroundPage().ClickyChrome.Background.stayNotification(this.id);
	});
	$("#scrollRightButton").live("click", function(){
		ClickyChrome.Notifications.scrollRight();
		return false;
	});
	$("#scrollLeftButton").live("click", function(){
		ClickyChrome.Notifications.scrollLeft();
		return false;
	});
	// External links
	$("a.external").live("click", function(){ClickyChrome.Notifications.externalLink($(this))});
});


ClickyChrome.Notifications.vars = {
	slide: 1,
	count: 0
};

/**
 * Build notification HTML from the query string data
 */
ClickyChrome.Notifications.buildNotification = function(){
	var goals = $.deparam.querystring(),
	html = '', displayClass,
	siteInfo = localStorage["clickychrome_currentSite"].split(','),
	ipLink, flagUrl, title = '', value = '';

	this.vars.count = ClickyChrome.Functions.objectSize(goals) - 1;

	title = this.vars.count > 1 ? this.vars.count + ' Goals: ' + siteInfo[2] : 'Goal: ' + siteInfo[2];

	html += '<div id="notification_header"><span id="scrollLeft"><a href="#" id="scrollLeftButton"><img src="/images/icon_left.png" alt="Scroll left" /></a></span>' +
			title + '<span id="scrollRight"><a href="#" id="scrollRightButton"><img src="/images/icon_right.png" alt="Scroll right" /></a></span></div>' +
			'<div id="notification_frame"><div id="notification_container">';

	for(var id in goals) {
		if(goals.hasOwnProperty(id) && id != 'id'){
			displayClass = goals[id].custom == 1 ? 'goal_custom' : '';
			ipLink = 'http://getclicky.com/stats/visitors?site_id=' + siteInfo[0] + '&ip_address=' + goals[id].ip;
			flagUrl = goals[id].cc == 'none' ? '/images/icon_world.png' : 'http://static.getclicky.com/media/flags/' + goals[id].cc + '.gif';
			value = goals[id].value == '' ? '' : '$' + goals[id].value;

			html += '<div class="notification_body"><div class="goal_value">' + value + '</div>' +
				'<div class="goal_name"><img src="/images/icon_goal.gif" class="goal_icon" alt="Goals Completed" />' +
				goals[id].goals + '</div><div class="goal_user"><span class="' + displayClass + '"><a class="external" href="' +
				ipLink + '">' + goals[id].visitor + '</a></span></div>' + '<div class="goal_geo"><img src="' + flagUrl + '" class="goal_flag" alt="Geolocation" />' +
				goals[id].geo + '</div><p class="session_link"><a class="external" href="' + goals[id].url + '">' + goals[id].time + '</a></p></div>';
		}
	}

	html += '</div></div>';

	$(".notification").html(html).attr("id", goals.id);
	$("#notification_container").css("width", this.vars.count * 300);
	if (this.debug) chrome.extension.getBackgroundPage().ClickyChrome.Background.log('Notification width: ' + $("#notification_container").width());
	this.checkScroll();
};

/**
 * Build notification HTML from the query string data
 */
ClickyChrome.Notifications.buildSampleNotification = function(){
	this.vars.count = 2;
	$("#notification_container").css("width", 600);
	this.checkScroll();
};

/**
 * Displays appropriate arrow icons for scrolling
 */
ClickyChrome.Notifications.checkScroll = function(){
	if (this.vars.slide < this.vars.count)
		$("#scrollRightButton").show();
	else
		$("#scrollRightButton").hide();
	if (this.vars.slide > 1)
		$("#scrollLeftButton").show();
	else
		$("#scrollLeftButton").hide();
};

/**
 * Scrolls notification widow to the right
 */
ClickyChrome.Notifications.scrollRight = function(){
	if (this.vars.slide < this.vars.count){
		$("#notification_container").animate({
			left: '-=300px'
			}, 300, function() {
				if (ClickyChrome.Notifications.debug) chrome.extension.getBackgroundPage().ClickyChrome.Background.log("Scrolled right");
		});
		this.vars.slide++;
	}
	this.checkScroll();
};

/**
 * Scrolls notification widow to the left
 */
ClickyChrome.Notifications.scrollLeft = function(){
	if (this.vars.slide > 1){
		$("#notification_container").animate({
			left: '+=300px'
			}, 300, function() {
				if (ClickyChrome.Notifications.debug) chrome.extension.getBackgroundPage().ClickyChrome.Background.log("Scrolled left");
		});
		this.vars.slide--;
	}
	this.checkScroll();
};

/**
 * Handles opening external links
 *
 * @param {string} link
 *		URL to open
 */
ClickyChrome.Notifications.externalLink = function(link){
	var windowUrl = link.attr("href");
	ClickyChrome.Functions.openUrl(windowUrl);
};