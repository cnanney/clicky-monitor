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

var ClickyChrome = ClickyChrome || {};

ClickyChrome.Options = {};

ClickyChrome.Options.debug = chrome.extension.getBackgroundPage().ClickyChrome.Background.debug;

$(function(){

  $(".edit_site").live("click", function(){
    $(this).parents("tr").find("div").toggleClass("off");
    $(this).parent("span").remove();
    return false;
  });

  $(".remove_site").live("click", function(){
    $(this).parents("tr").remove();
    ClickyChrome.Options.checkSites();
    return false;
  });

  $(".add_site").click(function(){
    var string = '<tr><td><div class="input_name"><input class="input_name" name="name[]" /></div></td>'+
      '<td><div class="input_url"><input class="input_url" name="url[]" /></div></td>'+
      '<td><div class="input_id"><input class="input_id" name="id[]" /></div></td>'+
      '<td><div class="input_key"><input class="input_key" name="key[]" /></div></td>'+
      '<td><span><a href="#" class="remove_site">remove</a></td></tr>';
    $("tbody").append(string);
    ClickyChrome.Options.checkSites();
    return false;
  });

  $("#toggle_problems").click(function(){
    $("#problems").slideToggle("slow");
    return false;
  });

  $("#toggle_import").click(function(){
    $("#import").slideToggle("slow");
    return false;
  });

  $("#options_help, #context_help").colorbox({title: true});

  $("#wipe").click(function(){
    ClickyChrome.Options.wipeData();
  });

  $("#goal_notification").change(function(){
    ClickyChrome.Options.checkVis($(this));
  });

  $("#sample_notification").live("click", function(){
    chrome.extension.getBackgroundPage().ClickyChrome.Background.createSampleNotification();
    return false;
  });

  $("#options_form").submit(function(){
    var missing = 0, invalid = 0, invalid_name = 0,
      num = $("tbody tr[id!=reminder]").length;

    if (num == 0){
      alert('You must add at least one site to use this extension.');
      return false;
    }
    else{

      // Do some validation
      $("input.input_id, input.input_key").each(function(){
        var value = $(this).val().replace(/^\s+|\s+$/g, "");
        $(this).val(value);
        if (value == ''){
          missing = 1;
        }
        var reg = /^[A-Za-z\d]+$/;
        if (!reg.test(value)){
          invalid = 1;
        }
      });

      $("input.input_name").each(function(){
        var value = $(this).val().replace(/^\s+|\s+$/g, "");
        $(this).val(value);
        if (value == ''){
          missing = 1;
        }
        if (value.indexOf(',') != -1){
          invalid_name = 1;
        }
      });

      $("input.input_url").each(function(){
        var value = $(this).val().replace(/^\s+|\s+$/g, "");
        value = value.replace(/(^[a-z][a-z0-9+\-.]*:\/\/)|(\/$)/ig, "");
        $(this).val(value);
        if (value.indexOf(',') != -1){
          invalid_name = 1;
        }
      });

      if (missing == 1){
        alert('You must enter a name, ID, and key for each site.');
        return false;
      }
      else if (invalid == 1){
        alert('Only letters and digits allowed for ID and Key fields.');
        return false;
      }
      else if (invalid_name == 1){
        alert('No commas allowed in site name or domain.');
        return false;
      }
      else{
        // A little JS-fu to get things into a nice object
        var data = $.deparam($(this).serialize());
        ClickyChrome.Options.saveData(data);
        return false;
      }
    }
  });

  $("#import_form").submit(function(){
    $("#import_loader").show();

    var username = escape($("#username").val()),
      password = escape($("#password").val()),
      apiString = 'https://api.getclicky.com/api/account/sites?username='+username+'&password='+password+'&output=json&app=clickychrome';

    $.ajax({
      url: apiString,
      cache: false,
      contentType: "application/json; charset=utf-8",
      dataType: "json",
      success: function(data){
        $("#import_loader").hide();
        if (data && data[0]){
          if (data[0].error){
            $("#import_error").show().text(data[0].error);
            console.log(data[0].error);
          }
          else{
            var imported = {
              name: [],
              url: [],
              id: [],
              key: []
            };
            for (var i = 0, c = data.length; i < c; i++){
              imported.name.push(data[i].nickname);
              imported.url.push(data[i].hostname);
              imported.id.push(data[i].site_id);
              imported.key.push(data[i].sitekey);
            }
            ClickyChrome.Options.saveImported(imported);
          }
        }
      },
      error: function(XMLHttpRequest, textStatus, errorThrown){
        console.log("Status: "+textStatus+", Error: "+errorThrown);
        console.log(XMLHttpRequest.responseText);
        $("#import_error").show().text('Unknown error, please try again later.');
      }
    });

    return false;
  });

  // Return a helper with preserved width of cells
  // http://lanitdev.wordpress.com/2009/07/23/make-table-rows-sortable-using-jquery-ui-sortable/
  var fixHelper = function(e, ui){
    ui.children().each(function(){
      $(this).width($(this).width());
    });
    return ui;
  };

  $("tbody").sortable({
    axis: 'y',
    handle: 'img',
    cursor: 'move',
    helper: fixHelper,
    forcePlaceholderSize: true,
    tolerance: 'pointer'
  });

});

ClickyChrome.Options.vars = {
  nameArray: [],
  urlArray: [],
  idArray: [],
  keyArray: [],
  currentArray: []
};

ClickyChrome.Options.init = function(){
  if (typeof localStorage["clickychrome_names"] != "undefined"){
    if (localStorage["clickychrome_names"].indexOf(',') == -1){
      this.vars.nameArray[0] = localStorage["clickychrome_names"];
      this.vars.urlArray[0] = localStorage["clickychrome_urls"];
      this.vars.idArray[0] = localStorage["clickychrome_ids"];
      this.vars.keyArray[0] = localStorage["clickychrome_keys"];
    }
    else{
      this.vars.nameArray = localStorage["clickychrome_names"].split(',');
      this.vars.urlArray = localStorage["clickychrome_urls"].split(',');
      this.vars.idArray = localStorage["clickychrome_ids"].split(',');
      this.vars.keyArray = localStorage["clickychrome_keys"].split(',');
    }

    if (typeof localStorage["clickychrome_currentSite"] == "undefined"){
      this.resetCurrent();
    }
    else{
      var name_match = 0, id_match = 0, key_match = 0;
      this.vars.currentArray = localStorage["clickychrome_currentSite"].split(',');
      for (var i = 0, c = this.vars.nameArray.length; i < c; i++){
        if (this.vars.nameArray[i] == this.vars.currentArray[2]) name_match = 1;
        if (this.vars.keyArray[i] == this.vars.currentArray[1]) key_match = 1;
        if (this.vars.idArray[i] == this.vars.currentArray[0]) id_match = 1;
      }
      if (name_match == 0 || key_match == 0 || id_match == 0){
        this.resetCurrent();
      }
    }
  }
  $(".color_input").each(function(){
    if ($(this).val() == localStorage["clickychrome_badgeColor"])
      $(this).attr("checked", "checked");
  });
  $(".spy_type").each(function(){
    if ($(this).val() == localStorage["clickychrome_spyType"])
      $(this).attr("checked", "checked");
  });
  $("#goal_notification").val(localStorage["clickychrome_goalNotification"]);
  $("#goal_timeout").val(localStorage["clickychrome_goalTimeout"]);
  if ($("#goal_notification").val() == 'no') $("#goal_notification").parent("li").next().hide();
  $("#problems, #import").slideUp('fast');
  $("#import_error").hide();
  $("#username, #password").val('');

  this.buildSiteTable();
};

ClickyChrome.Options.saveData = function(data){
  if (this.debug) console.log(data);
  localStorage["clickychrome_names"] = data.name.join(',');
  localStorage["clickychrome_urls"] = data.url.join(',');
  localStorage["clickychrome_ids"] = data.id.join(',');
  localStorage["clickychrome_keys"] = data.key.join(',');
  localStorage["clickychrome_badgeColor"] = data.badgeColor;
  localStorage["clickychrome_spyType"] = data.spyType;
  localStorage["clickychrome_goalNotification"] = data.goalNotification;
  localStorage["clickychrome_goalTimeout"] = data.goalTimeout;

  this.init();
  $("#save_feedback").show().text('Options saved. You can close this tab.').delay(6000).fadeOut(1000);
  chrome.extension.getBackgroundPage().ClickyChrome.Background.init();
};

ClickyChrome.Options.saveImported = function(data){
  if (this.debug) console.log(data);
  localStorage["clickychrome_names"] = data.name.join(',');
  localStorage["clickychrome_urls"] = data.url.join(',');
  localStorage["clickychrome_ids"] = data.id.join(',');
  localStorage["clickychrome_keys"] = data.key.join(',');

  this.init();
  chrome.extension.getBackgroundPage().ClickyChrome.Background.init();
};

ClickyChrome.Options.wipeData = function(){
  delete localStorage["clickychrome_names"];
  delete localStorage["clickychrome_urls"];
  delete localStorage["clickychrome_ids"];
  delete localStorage["clickychrome_keys"];
  delete localStorage["clickychrome_badgeColor"];
  delete localStorage["clickychrome_currentSite"];
  delete localStorage["clickychrome_currentChart"];
  delete localStorage["clickychrome_spyType"];
  delete localStorage["clickychrome_goalNotification"];
  delete localStorage["clickychrome_goalTimeout"];
  chrome.tabs.getSelected(null, function(tab){
    chrome.tabs.remove(tab.id);
  });
  chrome.extension.getBackgroundPage().ClickyChrome.Background.init();
};

ClickyChrome.Options.buildSiteTable = function(){
  $("tbody").empty();
  for (var i = 0, c = this.vars.nameArray.length; i < c; i++){
    var string = '<tr><td><div class="input_name"><img title="Drag to re-order" class="grip" src="/images/grippy.png" />'+
      this.vars.nameArray[i]+'</div><div class="input_name off"><input class="input_name" name="name[]" value="'+
      this.vars.nameArray[i]+'" /></div></td><td><div class="input_url">'+this.vars.urlArray[i]+'</div><div class="input_url off">'+
      '<input class="input_url" name="url[]" value="'+this.vars.urlArray[i]+'" /></div></td><td><div class="input_id">'+
      this.vars.idArray[i]+'</div><div class="input_id off"><input class="input_id" name="id[]" value="'+this.vars.idArray[i]+
      '" /></div></td><td><div class="input_key">'+this.vars.keyArray[i]+'</div><div class="input_key off"><input class="input_key" name="key[]" value="'+
      this.vars.keyArray[i]+
      '" /></div></td><td class="edit"><span><a href="#" class="edit_site">edit</a> | </span><a href="#" class="remove_site">remove</a></td></tr>';
    $("tbody").append(string);
  }
  this.checkSites();
};

ClickyChrome.Options.checkSites = function(){
  var num = $('tbody tr[id!=reminder]').length;
  if (num == 0){
    var string = '<tr id="reminder"><td colspan="5">You must add at least one site from your Clicky account to use this extension.</td></tr>';
    $("tbody").append(string);
  }
  else{
    $("#reminder").remove();
  }
};

ClickyChrome.Options.resetCurrent = function(){
  localStorage["clickychrome_currentSite"] = this.vars.idArray[0]+','+this.vars.keyArray[0]+','+this.vars.nameArray[0];
};

ClickyChrome.Options.checkVis = function(el){
  if (el.val() == 'no') el.parent("li").next().hide();
  else el.parent("li").next().show();
};