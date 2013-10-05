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

CM.bg = {
	vars: {
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
		spyTimes: {
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
	}
};


/**
 * Opens CM options page
 */
CM.bg.showOptions = function(){
	var windowUrl = chrome.extension.getURL("options.html");
	chrome.tabs.create({"url": windowUrl, "selected": true});
};

/**
 * One-time housekeeping to update local storage
 */
CM.bg.upgradeLocalStorage = function(){
	CM.log('localStorage out of date, updating...');

	// Remove each 'clickychrome_' localStorage variable
	$.each(localStorage, function(k, v){
		if (k.substring(0, 13) == 'clickychrome_'){
			CM.set(k.substring(13), v);
			delete localStorage[k];
		}
	});

	// Consolidate sites
	if (CM.get('keys')){
		var idArray = CM.get('ids').split(',');
		var keyArray = CM.get('keys').split(',');
		var nameArray = CM.get('names').split(',');
		var urlArray = CM.get('urls').split(',');
		var newSites = [];

		$.each(idArray, function(idx, val){
			newSites.push({
				id: val,
				key: keyArray[idx],
				name: nameArray[idx],
				url: urlArray[idx]
			});
		});

		CM.set('sites', newSites);

		// Get rid of the old properties
		var cm = CM.get();
		delete cm.ids;
		delete cm.keys;
		delete cm.names;
		delete cm.urls;
		store.set('cm', cm);
	}

	// Fix currentSite
	var oldCurrent = CM.get('currentSite');
	if (_.isString(oldCurrent) && ~oldCurrent.indexOf(',')){
		var currentArray = oldCurrent.split(',');
		var newCurrent = {
			id: currentArray[0],
			key: currentArray[1],
			name: currentArray[2]
		}
		CM.set('currentSite', newCurrent);
	}

};

/**
 * Initialize everything
 */
CM.bg.init = function(){
	if (this.vars.listening == 0) CM.log('###### START ######');



	// Set some defaults
	var defaults = {
		badgeColor: '0,0,0,200',
		currentChart: 'visitors',
		currentDate: 'today',
		customName: 'yes',
		goalNotification: 'no',
		goalTimeout: 10,
		spyType: 'online'
	};

	if (!CM.get() || CM.get('keys') || _.isString(CM.get('currentSite'))){
		this.upgradeLocalStorage();
	}

	for (var key in defaults){
		if (defaults.hasOwnProperty(key) && !CM.get(key)){
			CM.log('Default "%s" not set, setting to "%s"', key, defaults[key]);
			var newObj = {};
			newObj[key] = defaults[key];
			CM.extend(newObj);
		}
	}

	console.log(CM.get());

	// Set badge color
	var colors = CM.get('badgeColor').split(',');
	chrome.browserAction.setBadgeBackgroundColor({
		color: [Number(colors[0]), Number(colors[1]), Number(colors[2]), Number(colors[3])]
	});

	// If no current site, show options page
	if (!CM.get('currentSite')){
		CM.func.setTitle('Clicky Monitor');
		if (this.vars.spy){
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
	var patterns = [];
	$.each(CM.get('sites'), function(idx, site){
		if (site.url != ''){
			var clean = site.url.replace(/^((?:[a-z][a-z0-9+\-.]*:)?(?:\/\/)?(?:www\.)?)/ig, "");
			patterns.push('*://'+clean+'/*');
			patterns.push('*://www.'+clean+'/*');
		}
	});
	if (this.vars.contextMenu != 0){
		if (patterns.length == 0){
			chrome.contextMenus.remove(this.vars.contextMenu, function(){
				CM.log('Context menu destroyed');
				CM.bg.vars.contextMenu = 0;
			});
		}
		else{
			chrome.contextMenus.update(this.vars.contextMenu, {documentUrlPatterns: patterns}, function(){
				CM.log('Context menu updated with patterns: '+patterns.join(', '));
			});
		}
	}
	else{
		if (patterns.length != 0){
			this.vars.contextMenu = chrome.contextMenus.create({title: "View page stats", documentUrlPatterns: patterns, contexts:
				["all"], onclick: this.handleContext}, function(){
				CM.log('Context menu created with patterns: '+patterns.join(', '));
			});
		}
	}

};

/**
 * Query API for updated counts and completed goals
 */
CM.bg.checkSpy = function(){
	CM.log('Spy');

	CM.bg.updateGoalTime();

	var type = CM.bg.vars.type,
		offset = CM.bg.vars.goalTime;

	// Spy type variables
	var spyTypeInfo = {
		online: {
			urlString: CM.get('goalNotification') == "yes" ? '&type=visitors-online,visitors-list&goal=*&time_offset='+offset :
				'&type=visitors-online'
		},
		goals: {
			urlString: CM.get('goalNotification') == "yes" ? '&type=goals,visitors-list&goal=*&time_offset='+offset :
				'&type=goals'
		},
		visitors: {
			urlString: CM.get('goalNotification') == "yes" ? '&type=visitors,visitors-list&goal=*&time_offset='+offset :
				'&type=visitors'
		}
	};

	// Make sure a current site is selected before we proceed
	if (CM.get('currentSite')){

		var siteInfo = CM.get('currentSite');

		CM.bg.updateTitle(siteInfo);

		var apiString = 'http://api.getclicky.com/api/stats/4?site_id='+siteInfo.id+'&sitekey='+siteInfo.key+
			spyTypeInfo[CM.get('spyType')].urlString+'&date=today&output=json&app=clickychrome';

		if (type == 'live'){
			$.ajax({
				url: apiString,
				cache: false,
				contentType: "application/json; charset=utf-8",
				dataType: "json",
				success: function(data){
					if (data && data[0]){
						if (data[0].error){
							CM.func.setTitle(data[0].error);
							console.log(data[0].error);
							CM.func.setBadgeText('ERR');
						}
						else{
							CM.func.setBadgeNum(data[0].dates[0].items[0].value);
							if (CM.get('goalNotification') == "yes"){
								if (data[1].dates[0].items[0]){
									CM.log('Goals completed');
									CM.bg.createNotification(data[1].dates[0].items);
								}
							}
						}
					}
				},
				error: function(XMLHttpRequest, textStatus, errorThrown){
					console.log("Status: "+textStatus+", Error: "+errorThrown);
					console.log(XMLHttpRequest.responseText);
					CM.func.setBadgeText('ERR');
				}
			});
		}
		if (type == 'test'){
			CM.func.setBadgeText('ABC');
		}

	}
	else{
		CM.func.setTitle('CM');
	}

	if (CM.bg.debug){
		CM.log('Goal log:', CM.bg.vars.goalLog);
	}
};

/**
 * Attach event listeners to detect browser idle time
 */
CM.bg.beginListen = function(){
	this.vars.listening = 1;
	chrome.tabs.onSelectionChanged.addListener(function(){
		CM.bg.resetIdle();
	});
	chrome.tabs.onUpdated.addListener(function(){
		CM.bg.resetIdle();
	});
};

/**
 * Resets the idle timer
 */
CM.bg.resetIdle = function(){
	this.vars.touched = new Date().getTime();
	if (this.vars.regress == 1){
		this.vars.level = 0;
		this.vars.regress = 0;
		this.setRefresh(this.vars.spyTimes[this.vars.type].t1);

		CM.log('Idle reset, regress level 1');
	}
};

/**
 * Sets a new check interval with desired time delay
 *
 * @param {int} delay
 *    Time delay between checks in milliseconds
 */
CM.bg.setRefresh = function(delay){
	this.checkSpy();
	if (this.vars.spy){
		clearInterval(this.vars.spy);
		this.vars.spy = null;
	}
	this.vars.spy = setInterval(this.checkSpy, delay);
	this.toggleLevel();
};

/**
 * Toggles 'level' between 0 and 1 to facilitate steping between delay levels
 */
CM.bg.toggleLevel = function(){
	this.vars.level = this.vars.level == 0 ? 1 : 0;
};

/**
 * Stops all extension refreshing after broswer has been idle for 2 hours
 */
CM.bg.stopRefresh = function(){
	if (this.vars.spy){
		clearInterval(this.vars.spy);
		this.vars.spy = null;
	}
	if (this.vars.check){
		clearInterval(this.vars.check);
		this.vars.check = null;
		this.vars.listening = 0;
	}
	this.vars.level = 1;
	CM.func.setBadgeText('IDLE');
};

/**
 * Checks browser idle time and adjusts check frequency accordingly
 */
CM.bg.checkIdle = function(){
	var local = CM.bg.vars,
		now = new Date().getTime(),
		diff = now-local.touched;

	if (diff > local.checkTimes[local.type].t1) CM.bg.vars.regress = 1;
	if (diff > local.checkTimes[local.type].t1 && diff < local.checkTimes[local.type].t2){
		if (local.level == 1){
			CM.bg.setRefresh(local.spyTimes[local.type].t2);
			// Change color for testing
			if (local.type == 'test') CM.func.setBadgeColor([255, 0, 0, 200]);
			CM.log('Regress level 2');
		}
	}
	else if (diff > local.checkTimes[local.type].t2 && diff < local.checkTimes[local.type].t3){
		if (local.level == 0){
			CM.bg.setRefresh(local.spyTimes[local.type].t3);
			// Change color for testing
			if (local.type == 'test') CM.func.setBadgeColor([0, 255, 0, 200]);
			CM.log('Regress level 3');
		}
	}
	else if (diff > local.checkTimes[local.type].t3 && diff < local.checkTimes[local.type].t4){
		if (local.level == 1){
			CM.bg.setRefresh(local.spyTimes[local.type].t4);
			// Change color for testing
			if (local.type == 'test') CM.func.setBadgeColor([0, 0, 255, 200]);
			CM.log('Regress level 4');
		}
	}
	else if (diff > local.checkTimes[local.type].t4){
		if (local.level == 0){
			CM.bg.stopRefresh();
			// Change color for testing
			if (local.type == 'test') CM.func.setBadgeColor([0, 0, 0, 200]);
			CM.log('Regress level 5');
		}
	}
};

/**
 * Creates new HTML5 desktop notification for goal completion
 *
 * @param {array} data
 *    Goal data from API response
 */
CM.bg.createNotification = function(data){
	if (this.vars.showNotifications === false) return true;

	var nData = CM.process.goals(data);

	if (nData !== false){

		CM.log('Notification data', nData);

		this.vars.nCount += 1;
		var newNotification = webkitNotifications.createHTMLNotification(
			'notifications.html?id='+this.vars.nCount+'&'+$.param(nData)
		);
		newNotification.id = this.vars.nCount;
		newNotification.onclose = function(){
			delete CM.bg.vars.notifications[this.id];
			CM.log('Notification '+this.id+' closed');
		};
		this.vars.notifications[this.vars.nCount] = newNotification;
		newNotification.show();

		this.expireNotification(this.vars.nCount);
		CM.log('Notification '+this.vars.nCount+' created');
	}
};

/**
 * Creates sample HTML5 desktop notification
 */
CM.bg.createSampleNotification = function(){
	var newNotification = webkitNotifications.createHTMLNotification('/help/sample_notification.html');
	newNotification.show();
};

/**
 * Cancels notificatin expiration
 *
 * @param {int} id
 *    ID of notification to save
 */
CM.bg.stayNotification = function(id){
	if (this.vars.expire && id == this.vars.nCount){
		if (this.vars.expire){
			clearTimeout(this.vars.expire);
			this.vars.expire = null;
			CM.log('Notification '+id+' saved');
		}
	}
};

/**
 * Sets the notification to expire
 *
 * @param {int} id
 *    ID of notification to expire
 */
CM.bg.expireNotification = function(id){
	if (this.vars.expire){
		clearTimeout(this.vars.expire);
		this.vars.expire = null;
	}
	var timeout = Number(CM.get('goalTimeout')) * 1000;
	this.vars.expire = setTimeout(this.killNotification, timeout, id);
};

/**
 * Kills the notification
 *
 * @param {int} id
 *    ID of notification to kill
 */
CM.bg.killNotification = function(id){
	if (typeof CM.bg.vars.notifications[id] == 'object'){
		CM.bg.vars.notifications[id].cancel();
		CM.log('Notification '+id+' expired');
	}
	else{
		CM.log('Notification '+id+' unable to close');
	}
	if (CM.bg.vars.expire){
		clearTimeout(CM.bg.vars.expire);
		CM.bg.vars.expire = null;
	}
};

/**
 * Log function
 */
CM.bg.log = function(){
	CM.bg.debug && console.log(Array.prototype.slice.call(arguments));
};

/**
 * Set time of last completed goal
 */
CM.bg.updateGoalTime = function(){
	var t = new Date().getTime();
	if (t-this.vars.startTime > 600000){
		this.vars.goalTime = 600;
	}
	else{
		this.vars.goalTime = Math.floor((t-this.vars.startTime) / 1000)+30;
	}
	CM.log('New offset: '+this.vars.goalTime);
};

/**
 * Update goal log, cleans out old ones
 *
 * @param {object} log
 *    Log of all notified goals
 */
CM.bg.updateGoalLog = function(log){
	this.vars.goalLog = log;
	CM.log('Goal log updated');
	this.cleanGoalLog();
};

/**
 * Reset goal start time
 */
CM.bg.resetGoalStart = function(){
	this.vars.startTime = new Date().getTime();
	CM.log('Start time reset');
};

/**
 * Garbage collection for goal log
 */
CM.bg.cleanGoalLog = function(){
	var t = new Date().getTime(),
		check = Math.floor(t / 1000);
	for (var id in this.vars.goalLog){
		if (this.vars.goalLog.hasOwnProperty(id)){
			if (check-Number(this.vars.goalLog[id].timestamp) > 900){
				delete this.vars.goalLog[id];
				CM.log('#'+id+' deleted from log');
			}
		}
	}
	CM.log('Goal log cleaned');
};

/**
 * Updates extension title
 */
CM.bg.updateTitle = function(site){
	CM.func.setTitle(this.vars.titleInfo[CM.get('spyType')].titleString+site.name);
};

/**
 * Opens stats page from context menu
 *
 * @param {object} info
 *    Info about the page the menu was clicked on
 * @param {object} tab
 *    Chrome tab object for page
 */
CM.bg.handleContext = function(info, tab){
	var urlArray = CM.get('urls').split(','),
		idArray = CM.get('ids').split(',');

	for (var i = 0, c = urlArray.length; i < c; i++){
		var re = new RegExp(urlArray[i], "ig");
		if (re.test(info.pageUrl)){
			CM.log('Context matched '+urlArray[i]+', ID: '+idArray[i]);
			var urlParts = info.pageUrl.split('/'),
				contentUrl = 'http://getclicky.com/stats/visitors?site_id='+idArray[i]+'&href=';
			for (var j = 3, cn = urlParts.length; j < cn; j++){
				contentUrl += '/'+urlParts[j];
			}
			CM.func.openUrl(contentUrl);
			break;
		}
	}
};

CM.bg.init();