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

CM.popup = {};

$(function(){
  console.log('popup bindings');

  $('#popup-wrapper')
    // Site select
    .on('click', '#site-list a', function(){
      CM.popup.siteSelect($(this))
    })
    // Date select
    .on('click', '#date-list a', function(){
      CM.popup.dateSelect($(this))
    })
    // Chart select
    .on('click', '#chart-list a', function(){
      CM.popup.chartSelect($(this))
    })
    // External links
    .on('click', 'a.external, #chart a', function(){
      CM.popup.externalLink($(this))
    })
    // General click
    .on('click', function(){
      CM.popup.hideMenus();
    });


  // Tabs
  $('.nav-tab').on('click', function(){
    CM.popup.buildTab($(this))
  });

  // Open options page
  $('#show_options').on('click', function(){
    chrome.extension.getBackgroundPage().CM.bg.showOptions()
  });

  // Reset idle timer
  chrome.extension.getBackgroundPage().CM.bg.resetIdle();

  // Menu interactions
  $('#site-select').click(function(){
    $('#site-list').show();
    $('#date-list').hide();
    $('#chart-list').hide();
    return false;
  });

  $('#date-select').click(function(){
    if ($(this).hasClass('off') === false){
      $('#date-list').show();
      $('#site-list').hide();
    }
    return false;
  });

  $('#chart-select').click(function(){
    if ($(this).hasClass('off') === false){
      $('#chart-list').show();
      $('#site-list').hide();
    }
    return false;
  });

});

/**
 * Variables
 */
CM.popup.vars = {
  currentPage: 'basics',
  dateNames: {
    "today": "Today",
    "yesterday": "Yesterday",
    "last-7-days": "Last 7 Days",
    "last-30-days": "Last 30 Days"
  },
  chartNames: {
    "visitors": "Visitors",
    "actions": "Actions",
    "web-browsers": "Browsers"
  },
  nameArray: [],
  idArray: [],
  keyArray: []
};

/**
 * Start everything up
 */
CM.popup.init = function(){
  CM.log('popup init');

  CM.extend({currentDate: 'today'});

  var ls = store.get('cm');

  if (_.isEmpty(CM.get('sites'))){
    this.hideLoader();
    var html = '<p id="no_site">You must <a id="show_options" href="#">add at least one site</a> to use this extension.</p>';
    $('#main_tabs').hide();
    $('#content').html(html);
  }
  else{

    if (!~ls.names.indexOf(',')){
      this.vars.nameArray[0] = ls.names;
      this.vars.idArray[0] = ls.ids;
      this.vars.keyArray[0] = ls.keys;
    }
    else{
      this.vars.nameArray = ls.names.split(',');
      this.vars.idArray = ls.ids.split(',');
      this.vars.keyArray = ls.keys.split(',');
    }

    if (_.isUndefined(ls.currentSite) || ls.currentSite == ''){
      CM.extend({'currentSite': this.vars.idArray[0]+','+this.vars.keyArray[0]+','+this.vars.nameArray[0]});
    }
    this.buildMenus();
    this.buildPage(this.vars.currentPage);
  }
  // Assign current graph to menu
  $('#chart-list a').each(function(){
    if ($(this).attr('id') == ls.currentChart) $(this).addClass('current');
  });
};

/**
 * Builds site dropdown menu
 */
CM.popup.buildMenus = function(){
  var siteInfo = CM.get('currentSite').split(',');
  $('#site-select span').text(siteInfo[2]);
  CM.log('build menus', siteInfo);
  for (var i = 0, c = this.vars.idArray.length; i < c; i++){
    var string = '<li><a href="#" id="'+this.vars.idArray[i]+','+this.vars.keyArray[i]+','+this.vars.nameArray[i]+'"';
    if (siteInfo[0] == this.vars.idArray[i]){
      string += ' class="current"';
    }
    string += '>'+this.vars.nameArray[i]+'</a></li>';
    $('#site-list').append(string);
  }
  this.showMenuButtons();
};

/**
 * Hides loading graphic
 */
CM.popup.hideLoader = function(){
  $('#loading').hide();
};

/**
 * Shows loading graphic
 */
CM.popup.showLoader = function(){
  $('#loading').show();
};

/**
 * Hides menu dropdowns
 */
CM.popup.hideMenus = function(){
  $('#site-list,#date-list,#chart-list').hide();
};

/**
 * Menu buttons are hidden unless there is an active site
 */
CM.popup.showMenuButtons = function(){
  console.log('show menu buttons');
  $('#date-select-container, #site-select-container, #chart-select-container').show();
};

/**
 * Builds requsted page URL
 *
 * @param {string} page
 *    Which page to build
 */
CM.popup.buildPage = function(page){
  CM.log('Begin "'+page+'" page build');
  CM.build[page]();
};

/**
 * Loads HTML into #content div
 *
 * @param {string} html
 *    HTML to load
 */
CM.popup.loadHtml = function(html){
  if (html){
    $('#content').html(html);
    CM.log('HTML loaded');
  }
  this.hideLoader();
};

/**
 * Handles opening external links
 *
 * @param {string} link
 *    URL to open
 */
CM.popup.externalLink = function(link){
  var windowUrl = link.attr('href');
  CM.func.openUrl(windowUrl);
};

/**
 * Sets current date and chart on page load
 */
CM.popup.setDateName = function(){
  $('#date-select span').text(this.vars.dateNames[CM.get('currentDate')]);
};
CM.popup.setChartName = function(){
  $('#chart-select span').text(this.vars.chartNames[CM.get('currentChart')]);
};


/*
 * MENU SELECTIONS
 * ---------------------------------------------------------------------------------------------------------------------------*/

CM.popup.siteSelect = function(site){
  this.hideMenus();

  var text = site.text(),
    currentSite = site.attr('id');
  $('#site-select span').text(text);
  $('#site-list a').removeClass('current');
  site.addClass('current');

  CM.extend({'currentSite': currentSite});
  this.showLoader();

  this.buildPage(this.vars.currentPage);
  //chrome.extension.getBackgroundPage().CM.bg.resetGoalStart();
  chrome.extension.getBackgroundPage().CM.bg.updateTitle(currentSite.split(','));
};

CM.popup.dateSelect = function(date){
  this.hideMenus();

  var text = date.text();
  $('#date-select span').text(text);
  $('#date-list a').removeClass('current');
  date.addClass('current');

  CM.extend({'currentDate': date.attr('id')});
  this.showLoader();

  this.buildPage(this.vars.currentPage);
};

CM.popup.chartSelect = function(chart){
  this.hideMenus();

  var text = chart.text();
  $('#chart-select span').text(text);
  $('#chart-list a').removeClass('current');
  chart.addClass('current');

  CM.extend({'currentChart': chart.attr('id')});
  this.showLoader();

  this.buildPage(this.vars.currentPage);
};

/*
 * TABS
 * ---------------------------------------------------------------------------------------------------------------------------*/

CM.popup.buildTab = function(tab){
  this.hideMenus();
  this.vars.currentPage = tab.data('id');

  $('.nav-tab').removeClass('active');
  tab.addClass('active');

  this.setDateName();
  $('#date-select').removeClass('off');
  $('#chart-select').addClass('off');

  this.showLoader();
  this.buildPage(this.vars.currentPage);
};

$(function(){
  CM.popup.init();
});
