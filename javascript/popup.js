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

ClickyChrome.Popup = {};

ClickyChrome.Popup.debug = chrome.extension.getBackgroundPage().ClickyChrome.Background.debug;

$(function(){
	// Site select
	$("#site-list a").live("click", function(){ClickyChrome.Popup.siteSelect($(this))});
	// Date select
	$("#date-list a").live("click", function(){ClickyChrome.Popup.dateSelect($(this))});
	// Chart select
	$("#chart-list a").live("click", function(){ClickyChrome.Popup.chartSelect($(this))});

	// Basics tab
	$("#basics_tab").click(function(){ClickyChrome.Popup.basicsTab($(this))});
	// Visitors tab
	$("#visitors_tab").click(function(){ClickyChrome.Popup.visitorsTab($(this))});
	// Charts tab
	$("#charts_tab").click(function(){ClickyChrome.Popup.chartsTab($(this))});

	// External links
	$("a.external, #chart a").live("click", function(){ClickyChrome.Popup.externalLink($(this))});

	// Open options page
	$("#show_options").live("click", function(){chrome.extension.getBackgroundPage().ClickyChrome.Background.showOptions()});
	
	// Reset idle timer
	chrome.extension.getBackgroundPage().ClickyChrome.Background.resetIdle();

	// Menu interactions
	$("#site-select").click(function(){
		$("#site-list").show();
		$("#date-list").hide();
		$("#chart-list").hide();
		return false;
	});

	$("#date-select").click(function(){
		if ($(this).hasClass('off') === false){
			$("#date-list").show();
			$("#site-list").hide();
		}
		return false;
	});

	$("#chart-select").click(function(){
		if ($(this).hasClass('off') === false){
			$("#chart-list").show();
			$("#site-list").hide();
		}
		return false;
	});

	$("#wrapper").click(function(){
		ClickyChrome.Popup.hideMenus();
	});

});

/**
 * Variables
 */
ClickyChrome.Popup.vars = {
	currentPage: 'basics',
	dateNames: {
		"today":"Today",
		"yesterday":"Yesterday",
		"last-7-days":"Last 7 Days",
		"last-30-days":"Last 30 Days"
	},
	chartNames: {
		"visitors":"Visitors",
		"actions":"Actions",
		"web-browsers":"Browsers"
	},
	nameArray: [],
	idArray: [],
	keyArray: []
};

/**
 * Start everything up
 */
ClickyChrome.Popup.init = function(){
	if (typeof localStorage["clickychrome_names"] == "undefined"){
		this.hideLoader();
		var html = '<p id="no_site">You must <a id="show_options" href="#">add at least one site</a> to use this extension.</p>';
		$("#main_tabs").hide();
		$("#content").html(html);
	}
	else{
		localStorage["clickychrome_currentDate"] = 'today';

		if (localStorage["clickychrome_names"].indexOf(',') == -1){
			this.vars.nameArray[0] = localStorage["clickychrome_names"];
			this.vars.idArray[0] = localStorage["clickychrome_ids"];
			this.vars.keyArray[0] = localStorage["clickychrome_keys"];
		}
		else{
			this.vars.nameArray = localStorage["clickychrome_names"].split(',');
			this.vars.idArray = localStorage["clickychrome_ids"].split(',');
			this.vars.keyArray = localStorage["clickychrome_keys"].split(',');
		}

		if (typeof localStorage["clickychrome_currentSite"] == "undefined"){
			localStorage["clickychrome_currentSite"] = this.vars.idArray[0] + ',' + this.vars.keyArray[0] + ',' + this.vars.nameArray[0];
		}
		this.buildMenus();
		this.buildPage(this.vars.currentPage);
	}
	// Assign current graph to menu
	$("#chart-list a").each(function(){
		if ($(this).attr("id") == localStorage["clickychrome_currentChart"]) $(this).addClass("current");
	});
};

/**
 * Builds site dropdown menu
 */
ClickyChrome.Popup.buildMenus = function(){
	this.showMenuButtons();
	var siteInfo = localStorage["clickychrome_currentSite"].split(',');
	$("#site-select span").text(siteInfo[2]);
	for (var i = 0, c = this.vars.idArray.length; i < c; i++){
		var string = '<li><a href="#" id="' + this.vars.idArray[i] + ',' + this.vars.keyArray[i] + ',' + this.vars.nameArray[i] + '"';
		if (siteInfo[0] == this.vars.idArray[i]){
			string += ' class="current"';
		}
		string += '">' + this.vars.nameArray[i] + '</a></li>';
		$("#site-list").append(string);
	}
};

/**
 * Hides loading graphic
 */
ClickyChrome.Popup.hideLoader = function(){
	$("#loading").hide();
};

/**
 * Shows loading graphic
 */
ClickyChrome.Popup.showLoader = function(){
	$("#loading").show();
};

/**
 * Hides menu dropdowns
 */
ClickyChrome.Popup.hideMenus = function(){
	$("#site-list,#date-list,#chart-list").hide();
};

/**
 * Menu buttons are hidden unless there is an active site
 */
ClickyChrome.Popup.showMenuButtons = function(){
	$("#date-select-container,#site-select-container,#chart-select-container").show();
};

/**
 * Builds requsted page URL
 *
 * @param {string} page
 *		Which page to build
 */
ClickyChrome.Popup.buildPage = function(page){
	if (ClickyChrome.Popup.debug) console.log('Begin "' + page + '" page build');
	ClickyChrome.Build[page]();
};

/**
 * Loads HTML into #content div
 *
 * @param {string} html
 *		HTML to load
 */
ClickyChrome.Popup.loadHtml = function(html){
	if (html){
		$("#content").html(html);
		if (ClickyChrome.Popup.debug) console.log('HTML loaded');
	}
	this.hideLoader();
};

/**
 * Handles opening external links
 *
 * @param {string} link
 *		URL to open
 */
ClickyChrome.Popup.externalLink = function(link){
	var windowUrl = link.attr("href");
	ClickyChrome.Functions.openUrl(windowUrl);
};

/**
 * Sets current date and chart on page load
 */
ClickyChrome.Popup.setDateName = function(){
	$("#date-select span").text(this.vars.dateNames[localStorage["clickychrome_currentDate"]]);
};
ClickyChrome.Popup.setChartName = function(){
	$("#chart-select span").text(this.vars.chartNames[localStorage["clickychrome_currentChart"]]);
};


/*
 * MENU SELECTIONS
 * ---------------------------------------------------------------------------------------------------------------------------*/

ClickyChrome.Popup.siteSelect = function(site){
	this.hideMenus();

	var text = site.text(),
	id = site.attr('id');
	$("#site-select span").text(text);
	$("#site-list a").removeClass('current');
	site.addClass('current');

	localStorage["clickychrome_currentSite"] = id;
	this.showLoader();

	this.buildPage(this.vars.currentPage);
	//chrome.extension.getBackgroundPage().ClickyChrome.Background.resetGoalStart();
	chrome.extension.getBackgroundPage().ClickyChrome.Background.updateTitle(id.split(','));
};

ClickyChrome.Popup.dateSelect = function(date){
	this.hideMenus();

	var text = date.text();
	$("#date-select span").text(text);
	$("#date-list a").removeClass('current');
	date.addClass('current');

	localStorage["clickychrome_currentDate"] = date.attr('id');
	this.showLoader();

	this.buildPage(this.vars.currentPage);
};

ClickyChrome.Popup.chartSelect = function(chart){
	this.hideMenus();

	var text = chart.text();
	$("#chart-select span").text(text);
	$("#chart-list a").removeClass('current');
	chart.addClass('current');

	localStorage["clickychrome_currentChart"] = chart.attr('id');
	this.showLoader();

	this.buildPage(this.vars.currentPage);
};

/*
 * TABS
 * ---------------------------------------------------------------------------------------------------------------------------*/

ClickyChrome.Popup.basicsTab = function(tab){
	this.hideMenus();
	this.vars.currentPage = 'basics';

	$("#main_tabs a").removeClass('active');
	tab.addClass('active');

	this.setDateName();
	$("#date-select").removeClass('off');
	$("#chart-select").addClass('off');

	this.showLoader();
	this.buildPage(this.vars.currentPage);
};

ClickyChrome.Popup.visitorsTab = function(tab){
	this.hideMenus();
	this.vars.currentPage = 'visitors';
	
	$("#main_tabs a").removeClass('active');
	tab.addClass('active');

	$("#date-select").addClass('off');
	$("#chart-select").addClass('off');

	this.showLoader();
	this.buildPage(this.vars.currentPage);
}

ClickyChrome.Popup.chartsTab = function(tab){
	this.hideMenus();
	this.vars.currentPage = 'charts';

	$("#main_tabs a").removeClass('active');
	tab.addClass('active');

	this.setChartName();
	$("#date-select").addClass('off');
	$("#chart-select").removeClass('off');

	this.showLoader();
	this.buildPage(this.vars.currentPage);
};