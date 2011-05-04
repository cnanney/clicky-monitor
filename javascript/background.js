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
 *
 * Version 2.0.3 - Saturday, March 19, 2011
 */

var ClickyChrome = ClickyChrome || {};

ClickyChrome.Background = {};

ClickyChrome.Background.debug = false; // log events to console

ClickyChrome.Background.vars = {
	type: 'live', // test or live
	listening: 0,
	regress: 0,
	level: 0,
	touched: 0,
	nCount: 0,
	offset: 0,
	spy: null,
	check: null,
	expire: null,
	idleCheck: {
		test: 490,
		live: 59900
	},
	spyTimes:{
		test: {
			t1: 1000,
			t2: 1000,
			t3: 1000,
			t4: 1000
		},
		live: {
			t1: 60000,
			t2: 120000,
			t3: 300000,
			t4: 600000
		}
	},
	checkTimes: {
		test: {
			t1: 500,
			t2: 1000,
			t3: 1500,
			t4: 2000
		},
		live: {
			t1: 600000,
			t2: 1800000,
			t3: 3600000,
			t4: 7200000
		}
	},
	notifications: {},
	showNotifications: true,
	goalTime: 0,
	goalLog: {},
	startTime: new Date().getTime(),
	titleInfo: {
		online: {
			titleString: 'Visitors Online: '
		},
		goals: {
			titleString: 'Goals Completed: '
		},
		visitors: {
			titleString: 'Visitors Today: '
		}
	},
	contextMenu: 0
};

/**
 * Opens ClickyChrome options page
 */
ClickyChrome.Background.showOptions = function(){
	var windowUrl = chrome.extension.getURL("options.html");
	chrome.tabs.create({"url": windowUrl, "selected": true});
};

/**
 * Initialize everything
 */
ClickyChrome.Background.init = function(){
	if (this.debug && this.vars.listening == 0) console.log('###### START ######');

	// Set some defaults
	if (typeof localStorage["clickychrome_badgeColor"] == "undefined")
		localStorage["clickychrome_badgeColor"] = "0,0,0,200";
	if (typeof localStorage["clickychrome_currentChart"] == "undefined")
		localStorage["clickychrome_currentChart"] = "visitors";
	if (typeof localStorage["clickychrome_customName"] == "undefined")
		localStorage["clickychrome_customName"] = "yes";
	if (typeof localStorage["clickychrome_spyType"] == "undefined")
		localStorage["clickychrome_spyType"] = "online";
	if (typeof localStorage["clickychrome_goalNotification"] == "undefined")
		localStorage["clickychrome_goalNotification"] = "no";
	if (typeof localStorage["clickychrome_goalTimeout"] == "undefined")
		localStorage["clickychrome_goalTimeout"] = "10";
	if (typeof localStorage["clickychrome_urls"] == "undefined" && typeof localStorage["clickychrome_ids"] != "undefined"){
		var names = localStorage["clickychrome_names"].split(','),
		blankUrls = [];
		for (var j = 0, cn = names.length; j < cn; j++){
			blankUrls[j] = '';
		}
		localStorage["clickychrome_urls"] = blankUrls.join(',');
	}
	
	var colors = localStorage["clickychrome_badgeColor"].split(',');
	chrome.browserAction.setBadgeBackgroundColor({color:[Number(colors[0]), Number(colors[1]), Number(colors[2]), Number(colors[3])]});

	// If no current site, show options page
	if (typeof localStorage["clickychrome_currentSite"] == "undefined"){
		ClickyChrome.Functions.setTitle('ClickyChrome');
		if(this.vars.spy){
			clearInterval(this.vars.spy);
			this.vars.spy = null;
		}
		this.showOptions();
	}
	// Otherwise, start it up
	else{
		this.vars.regress = 0;
		this.resetIdle();
		this.setRefresh(this.vars.spyTimes[this.vars.type].t1);
		// Listen for browser idle
		if (this.vars.listening == 0){
			this.beginListen();
			this.vars.check = setInterval(this.checkIdle, this.vars.idleCheck[this.vars.type]);
		}
	}
	
	// Context menu
	if (typeof localStorage["clickychrome_urls"] != "undefined"){
		var urls = localStorage["clickychrome_urls"].split(','),
		patterns = [], clean;
		for (var i = 0, c = urls.length; i < c; i++){
			if (urls[i] != ''){
				clean = urls[i].replace(/^((?:[a-z][a-z0-9+\-.]*:)?(?:\/\/)?(?:www\.)?)/ig, "");
				patterns.push('*://' + clean + '/*');
				patterns.push('*://www.' + clean + '/*');
			}
		}
		if(this.vars.contextMenu != 0){
			if (patterns.length == 0){
				chrome.contextMenus.remove(this.vars.contextMenu, function(){
					if (ClickyChrome.Background.debug) console.log('Context menu destroyed');
					ClickyChrome.Background.vars.contextMenu = 0;
				});
			}
			else{
				chrome.contextMenus.update(this.vars.contextMenu, {documentUrlPatterns: patterns}, function(){
					if (ClickyChrome.Background.debug) console.log('Context menu updated with patterns: ' + patterns.join(', '));
				});
			}
		}
		else{
			if (patterns.length != 0){
				this.vars.contextMenu = chrome.contextMenus.create({title: "View page stats", documentUrlPatterns: patterns, contexts: ["all"], onclick: this.handleContext}, function(){
					if (ClickyChrome.Background.debug) console.log('Context menu created with patterns: ' + patterns.join(', '));
				});
			}
		}
	}
	
};

/**
 * Query API for updated counts and completed goals
 */
ClickyChrome.Background.checkSpy = function(){
	if (ClickyChrome.Background.debug) console.log('Spy');

	ClickyChrome.Background.updateGoalTime();

	var type = ClickyChrome.Background.vars.type,
	offset = ClickyChrome.Background.vars.goalTime;

	// Spy type variables
	var spyTypeInfo = {
		online: {
			urlString: localStorage["clickychrome_goalNotification"] == "yes" ? '&type=visitors-online,visitors-list&goal=*&time_offset=' + offset :
				'&type=visitors-online'
		},
		goals: {
			urlString: localStorage["clickychrome_goalNotification"] == "yes" ? '&type=goals,visitors-list&goal=*&time_offset=' + offset :
				'&type=goals'
		},
		visitors: {
			urlString: localStorage["clickychrome_goalNotification"] == "yes" ? '&type=visitors,visitors-list&goal=*&time_offset=' + offset :
				'&type=visitors'
		}
	};

	// Make sure a current site is selected before we proceed
	if (typeof localStorage["clickychrome_currentSite"] != "undefined"){

		var siteInfo = localStorage["clickychrome_currentSite"].split(',');

		ClickyChrome.Background.updateTitle(siteInfo);
		
		var apiString = 'http://api.getclicky.com/api/stats/4?site_id=' +	siteInfo[0] + '&sitekey=' + siteInfo[1] +
			spyTypeInfo[localStorage["clickychrome_spyType"]].urlString + '&date=today&output=json&app=clickychrome';

		if (type == 'live'){
			$.ajax({
				url: apiString,
				cache: false,
				contentType: "application/json; charset=utf-8",
				dataType: "json",
				success: function(data){
					if (data && data[0]){
						if (data[0].error){
							ClickyChrome.Functions.setTitle(data[0].error);
							console.log(data[0].error);
							ClickyChrome.Functions.setBadgeText('ERR');
						}
						else{
							ClickyChrome.Functions.setBadgeNum(data[0].dates[0].items[0].value);
							if (localStorage["clickychrome_goalNotification"] == "yes"){
								if (data[1].dates[0].items[0]){
									if (ClickyChrome.Background.debug) console.log('Goals completed');
									ClickyChrome.Background.createNotification(data[1].dates[0].items);
								}
							}
						}
					}
				},
				error: function (XMLHttpRequest, textStatus, errorThrown) {
					console.log("Status: "+textStatus+", Error: "+errorThrown);
					console.log(XMLHttpRequest.responseText);
					ClickyChrome.Functions.setBadgeText('ERR');
				}
			});
		}
		if (type == 'test'){
			ClickyChrome.Functions.setBadgeText('ABC');
		}
	
	}
	else{
		ClickyChrome.Functions.setTitle('ClickyChrome');
	}

	if (ClickyChrome.Background.debug){
		console.log('Goal log...')
		console.log(ClickyChrome.Background.vars.goalLog);
	}
};

/**
 * Attach event listeners to detect browser idle time
 */
ClickyChrome.Background.beginListen = function(){
	this.vars.listening = 1;
	chrome.tabs.onSelectionChanged.addListener(function(){
		ClickyChrome.Background.resetIdle();
	});
	chrome.tabs.onUpdated.addListener(function(){
		ClickyChrome.Background.resetIdle();
	});
};

/**
 * Resets the idle timer
 */
ClickyChrome.Background.resetIdle = function(){
	this.vars.touched = new Date().getTime();
	if (this.vars.regress == 1){
		this.vars.level = 0;
		this.vars.regress = 0;
		this.setRefresh(this.vars.spyTimes[this.vars.type].t1);
		if (this.debug) console.log('Idle reset, regress level 1');
	}
};

/**
 * Sets a new check interval with desired time delay
 *
 * @param {int} delay
 *		Time delay between checks in milliseconds
 */
ClickyChrome.Background.setRefresh = function(delay){
	this.checkSpy();
	if(this.vars.spy){
		clearInterval(this.vars.spy);
		this.vars.spy = null;
	}
	this.vars.spy = setInterval(this.checkSpy, delay);
	this.toggleLevel();
};

/**
 * Toggles 'level' between 0 and 1 to facilitate steping between delay levels
 */
ClickyChrome.Background.toggleLevel = function(){
	this.vars.level = this.vars.level == 0 ? 1 : 0;
};

/**
 * Stops all extension refreshing after broswer has been idle for 2 hours
 */
ClickyChrome.Background.stopRefresh = function(){
	if(this.vars.spy){
		clearInterval(this.vars.spy);
		this.vars.spy = null;
	}
	if(this.vars.check){
		clearInterval(this.vars.check);
		this.vars.check = null;
		this.vars.listening = 0;
	}
	this.vars.level = 1;
	ClickyChrome.Functions.setBadgeText('IDLE');
};

/**
 * Checks browser idle time and adjusts check frequency accordingly
 */
ClickyChrome.Background.checkIdle = function(){
	var local = ClickyChrome.Background.vars,
	now = new Date().getTime(),
	diff = now - local.touched;

	if (diff > local.checkTimes[local.type].t1) ClickyChrome.Background.vars.regress = 1;
	if (diff > local.checkTimes[local.type].t1 && diff < local.checkTimes[local.type].t2){
		if (local.level == 1){
			ClickyChrome.Background.setRefresh(local.spyTimes[local.type].t2);
			// Change color for testing
			if (local.type == 'test') ClickyChrome.Functions.setBadgeColor([255, 0, 0, 200]);
			if (ClickyChrome.Background.debug) console.log('Regress level 2');
		}
	}
	else if (diff > local.checkTimes[local.type].t2 && diff < local.checkTimes[local.type].t3){
		if (local.level == 0){
			ClickyChrome.Background.setRefresh(local.spyTimes[local.type].t3);
			// Change color for testing
			if (local.type == 'test') ClickyChrome.Functions.setBadgeColor([0, 255, 0, 200]);
			if (ClickyChrome.Background.debug) console.log('Regress level 3');
		}
	}
	else if (diff > local.checkTimes[local.type].t3 && diff < local.checkTimes[local.type].t4){
		if (local.level == 1){
			ClickyChrome.Background.setRefresh(local.spyTimes[local.type].t4);
			// Change color for testing
			if (local.type == 'test') ClickyChrome.Functions.setBadgeColor([0, 0, 255, 200]);
			if (ClickyChrome.Background.debug) console.log('Regress level 4');
		}
	}
	else if (diff > local.checkTimes[local.type].t4){
		if (local.level == 0){
			ClickyChrome.Background.stopRefresh();
			// Change color for testing
			if (local.type == 'test') ClickyChrome.Functions.setBadgeColor([0, 0, 0, 200]);
			if (ClickyChrome.Background.debug) console.log('Regress level 5');
		}
	}
};

/**
 * Creates new HTML5 desktop notification for goal completion
 * 
 * @param {array} data
 *		Goal data from API response
 */
ClickyChrome.Background.createNotification = function(data){
	if (this.vars.showNotifications === false) return true;

	var nData = ClickyChrome.Process.goals(data);

	if (nData !== false){

		if (this.debug){
			console.log('Notification data...')
			console.log(nData);
		}

		this.vars.nCount += 1;
		var newNotification = webkitNotifications.createHTMLNotification(
		  'notifications.html?id=' + this.vars.nCount + '&' + $.param(nData)
		);
		newNotification.id = this.vars.nCount;
		newNotification.onclose = function(){
			delete ClickyChrome.Background.vars.notifications[this.id];
			if (ClickyChrome.Background.debug) console.log('Notification ' + this.id + ' closed');
		};
		this.vars.notifications[this.vars.nCount] = newNotification;
		newNotification.show();

		this.expireNotification(this.vars.nCount);
		if (this.debug) console.log('Notification ' + this.vars.nCount + ' created');
	}
};

/**
 * Creates sample HTML5 desktop notification
 */
ClickyChrome.Background.createSampleNotification = function(){
	var newNotification = webkitNotifications.createHTMLNotification('/help/sample_notification.html');
	newNotification.show();
};

/**
 * Cancels notificatin expiration
 * 
 * @param {int} id
 *		ID of notification to save
 */
ClickyChrome.Background.stayNotification = function(id){
	if (this.vars.expire && id == this.vars.nCount){
		if (this.vars.expire){
			clearTimeout(this.vars.expire);
			this.vars.expire = null;
			if (this.debug) console.log('Notification ' + id + ' saved');
		}
	}
};

/**
 * Sets the notification to expire
 * 
 * @param {int} id
 *		ID of notification to expire
 */
ClickyChrome.Background.expireNotification = function(id){
	if (this.vars.expire){
		clearTimeout(this.vars.expire);
		this.vars.expire = null;
	}
	var timeout = Number(localStorage["clickychrome_goalTimeout"]) * 1000;
	this.vars.expire = setTimeout(this.killNotification, timeout, id);
};

/**
 * Kills the notification
 * 
 * @param {int} id
 *		ID of notification to kill
 */
ClickyChrome.Background.killNotification = function(id){
	if (typeof ClickyChrome.Background.vars.notifications[id] == 'object'){
		ClickyChrome.Background.vars.notifications[id].cancel();
		if (ClickyChrome.Background.debug) console.log('Notification ' + id + ' expired');
	}
	else{
		if (ClickyChrome.Background.debug) console.log('Notification ' + id + ' unable to close');
	}
	if (ClickyChrome.Background.vars.expire){
		clearTimeout(ClickyChrome.Background.vars.expire);
		ClickyChrome.Background.vars.expire = null;
	}
};

/**
 * Log function for notifications to use, because they aren't allowed to use console.log
 * 
 * @param {mixed} what
 *		What to log, duh
 */
ClickyChrome.Background.log = function(what){
	console.log(what);
};

/**
 * Set time of last completed goal
 */
ClickyChrome.Background.updateGoalTime = function(){
	var t = new Date().getTime();
	if (t - this.vars.startTime > 600000){
		this.vars.goalTime = 600;
	}
	else{
		this.vars.goalTime = Math.floor((t - this.vars.startTime)/1000) + 30;
	}
	if (this.debug) console.log('New offset: ' + this.vars.goalTime);
};

/**
 * Update goal log, cleans out old ones
 * 
 * @param {object} log
 *		Log of all notified goals
 */
ClickyChrome.Background.updateGoalLog = function(log){
	this.vars.goalLog = log;
	if (this.debug) console.log('Goal log updated');
	this.cleanGoalLog();
};

/**
 * Reset goal start time
 */
ClickyChrome.Background.resetGoalStart = function(){
	this.vars.startTime = new Date().getTime();
	if (this.debug) console.log('Start time reset');
};

/**
 * Garbage collection for goal log
 */
ClickyChrome.Background.cleanGoalLog = function(){
	var t = new Date().getTime(),
	check = Math.floor(t/1000);
	for(var id in this.vars.goalLog){
		if(this.vars.goalLog.hasOwnProperty(id)){
			if (check - Number(this.vars.goalLog[id].timestamp) > 900){
				delete this.vars.goalLog[id];
				if (this.debug) console.log('#' + id + ' deleted from log');
			}
		}
	}
	if (this.debug) console.log('Goal log cleaned');
};

/**
 * Updates extension title
 * 
 * @param {array} siteInfo
 *		Array of site id, key and name
 */
ClickyChrome.Background.updateTitle = function(siteInfo){
	ClickyChrome.Functions.setTitle(this.vars.titleInfo[localStorage["clickychrome_spyType"]].titleString + siteInfo[2]);
};

/**
 * Opens stats page from context menu
 * 
 * @param {object} info
 *		Info about the page the menu was clicked on
 * @param {object} tab
 *		Chrome tab object for page
 */
ClickyChrome.Background.handleContext = function(info, tab){
	var urlArray = localStorage["clickychrome_urls"].split(','),
	idArray = localStorage["clickychrome_ids"].split(',');
	
	for (var i = 0, c = urlArray.length; i < c; i++){
		var re = new RegExp(urlArray[i], "ig");
		if (re.test(info.pageUrl)){
			if (ClickyChrome.Background.debug) console.log('Context matched ' + urlArray[i] + ', ID: ' + idArray[i]);
			var urlParts = info.pageUrl.split('/'),
			contentUrl = 'http://getclicky.com/stats/visitors?site_id=' + idArray[i] + '&href=';
			for (var j = 3, cn = urlParts.length; j < cn; j++){
				contentUrl += '/' + urlParts[j];
			}
			ClickyChrome.Functions.openUrl(contentUrl);
			break;
		}
	}
};