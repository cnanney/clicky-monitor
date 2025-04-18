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

ClickyChrome.Popup = {}

// Get debug state asynchronously from background
async function getDebugState() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDebugState' })
    return response?.debug || false
  } catch (error) {
    console.error('Error getting debug state:', error)
    return false // Assume not debugging if communication fails
  }
}

;(async () => {
  // Wrap in async IIFE to use await at top level
  ClickyChrome.Popup.debug = await getDebugState()
  if (ClickyChrome.Popup.debug) console.log('Popup script loaded.')

  // --- Event Listeners ---
  $(async function () {
    // Standard jQuery document ready
    // Site select
    $('#site-list').on('click', 'a', async function (e) {
      e.preventDefault()
      await ClickyChrome.Popup.siteSelect($(this))
    })
    // Date select
    $('#date-list').on('click', 'a', async function (e) {
      e.preventDefault()
      await ClickyChrome.Popup.dateSelect($(this))
    })
    // Chart select
    $('#chart-list').on('click', 'a', async function (e) {
      e.preventDefault()
      await ClickyChrome.Popup.chartSelect($(this))
    })

    // Tabs
    $('#basics_tab').on('click', async function (e) {
      e.preventDefault()
      await ClickyChrome.Popup.basicsTab($(this))
    })
    $('#visitors_tab').on('click', async function (e) {
      e.preventDefault()
      await ClickyChrome.Popup.visitorsTab($(this))
    })
    $('#charts_tab').on('click', async function (e) {
      e.preventDefault()
      await ClickyChrome.Popup.chartsTab($(this))
    })

    // External links
    $('body').on('click', 'a.external, #chart a', function (e) {
      // Use body delegation for dynamically added links
      e.preventDefault()
      ClickyChrome.Popup.externalLink($(this))
    })

    // Open options page
    $('#show_options').on('click', function (e) {
      e.preventDefault()
      chrome.runtime.sendMessage({ action: 'showOptions' })
    })

    // Trigger background check on popup open (replaces resetIdle)
    chrome.runtime.sendMessage({ action: 'triggerApiCheck' })

    // Menu interactions (remain largely the same)
    $('#site-select').on('click', function (e) {
      e.preventDefault()
      $('#site-list').show()
      $('#date-list').hide()
      $('#chart-list').hide()
    })

    $('#date-select').on('click', function (e) {
      e.preventDefault()
      if (!$(this).hasClass('off')) {
        $('#date-list').show()
        $('#site-list').hide()
        $('#chart-list').hide()
      }
    })

    $('#chart-select').on('click', function (e) {
      e.preventDefault()
      if (!$(this).hasClass('off')) {
        $('#chart-list').show()
        $('#site-list').hide()
        $('#date-list').hide()
      }
    })

    $('#wrapper').on('click', function (e) {
      // Hide menus if clicking outside them
      if (!$(e.target).closest('.dropdown').length) {
        ClickyChrome.Popup.hideMenus()
      }
    })

    // Initialize the popup
    await ClickyChrome.Popup.init()
  })
})() // End async IIFE

/**
 * Variables (mostly UI state, storage holds persistent config)
 */
ClickyChrome.Popup.vars = {
  currentPage: 'basics',
  dateNames: {
    today: 'Today',
    yesterday: 'Yesterday',
    'last-7-days': 'Last 7 Days',
    'last-30-days': 'Last 30 Days',
  },
  chartNames: {
    visitors: 'Visitors',
    actions: 'Actions',
    'web-browsers': 'Browsers',
  },
  // Site arrays are now built dynamically from storage in init
}

/**
 * Initialize the popup UI
 */
ClickyChrome.Popup.init = async function () {
  if (ClickyChrome.Popup.debug) console.log('Popup init started.')
  try {
    const data = await chrome.storage.local.get([
      'clickychrome_names',
      'clickychrome_ids',
      'clickychrome_keys',
      'clickychrome_currentSite',
      'clickychrome_currentDate', // Store current date selection
      'clickychrome_currentChart', // Store current chart selection
    ])

    if (!data.clickychrome_names || !data.clickychrome_ids || !data.clickychrome_keys) {
      this.hideLoader()
      const html =
        '<p id="no_site">You must <a id="show_options" href="#">add at least one site</a> via the Options page to use this extension.</p>'
      $('#main_tabs').hide()
      $('#dropdowns').hide() // Hide dropdowns too
      $('#content').html(html)
      if (ClickyChrome.Popup.debug) console.log('No sites configured.')
      return
    }

    // Ensure defaults if they are missing from storage somehow
    const currentDate = data.clickychrome_currentDate || 'today'
    const currentChart = data.clickychrome_currentChart || 'visitors'
    await chrome.storage.local.set({
      clickychrome_currentDate: currentDate,
      clickychrome_currentChart: currentChart,
    })

    const nameArray = data.clickychrome_names.split(',')
    const idArray = data.clickychrome_ids.split(',')
    const keyArray = data.clickychrome_keys.split(',')

    let currentSite = data.clickychrome_currentSite
    // If no current site is set, or if the current site is invalid, default to the first one
    const currentSiteInfo = currentSite ? currentSite.split(',') : null
    let isValidCurrentSite = false
    if (currentSiteInfo && currentSiteInfo.length === 3) {
      const siteIndex = idArray.indexOf(currentSiteInfo[0])
      if (
        siteIndex > -1 &&
        keyArray[siteIndex] === currentSiteInfo[1] &&
        nameArray[siteIndex] === currentSiteInfo[2]
      ) {
        isValidCurrentSite = true
      }
    }

    if (!isValidCurrentSite && nameArray.length > 0) {
      currentSite = `${idArray[0]},${keyArray[0]},${nameArray[0]}`
      await chrome.storage.local.set({ clickychrome_currentSite: currentSite })
      if (ClickyChrome.Popup.debug) console.log('Setting default current site:', currentSite)
    }

    await this.buildMenus(nameArray, idArray, keyArray, currentSite)
    this.setDateName(currentDate)
    this.setChartName(currentChart)
    this.updateTabAndControls(this.vars.currentPage) // Ensure correct controls are shown/hidden initially

    await this.buildPage(this.vars.currentPage)
  } catch (error) {
    console.error('Error during popup initialization:', error)
    this.hideLoader()
    $('#content').html(
      '<p id="no_site">An error occurred loading extension data. Try reloading the popup or checking the console.</p>'
    )
  }
}

/**
 * Builds site dropdown menu
 */
ClickyChrome.Popup.buildMenus = async function (nameArray, idArray, keyArray, currentSite) {
  this.showMenuButtons()
  const siteInfo = currentSite.split(',')
  $('#site-select span').text(siteInfo[2]) // Set current site name display
  $('#site-list').empty() // Clear previous items

  for (let i = 0; i < idArray.length; i++) {
    const siteValue = `${idArray[i]},${keyArray[i]},${nameArray[i]}`
    let itemClass = ''
    if (siteInfo[0] === idArray[i]) {
      itemClass = ' class="current"'
    }
    const string = `<li><a href="#" id="${siteValue.replace(/"/g, '&quot;')}"${itemClass}>${
      nameArray[i]
    }</a></li>`
    $('#site-list').append(string)
  }
  if (ClickyChrome.Popup.debug) console.log('Site menu built.')

  // Set current chart and date menu items
  $('#date-list a').removeClass('current')
  $(`#date-list a#${await this.getCurrentDate()}`).addClass('current')

  $('#chart-list a').removeClass('current')
  $(`#chart-list a#${await this.getCurrentChart()}`).addClass('current')
}

/**
 * Hides loading graphic
 */
ClickyChrome.Popup.hideLoader = function () {
  $('#loading').hide()
}

/**
 * Shows loading graphic
 */
ClickyChrome.Popup.showLoader = function () {
  $('#loading').show()
}

/**
 * Hides menu dropdowns
 */
ClickyChrome.Popup.hideMenus = function () {
  $('#site-list, #date-list, #chart-list').hide()
}

/**
 * Menu buttons are hidden unless there is an active site
 */
ClickyChrome.Popup.showMenuButtons = function () {
  $('#date-select-container, #site-select-container, #chart-select-container').show()
}

/**
 * Builds requested page content by calling ClickyChrome.Build
 */
ClickyChrome.Popup.buildPage = async function (page) {
  if (ClickyChrome.Popup.debug) console.log(`Begin "${page}" page build`)
  this.showLoader() // Show loader before building
  try {
    // Check if the build function exists
    if (typeof ClickyChrome.Build?.[page] === 'function') {
      // Pass necessary context like current date/chart/site
      const currentSite = (await chrome.storage.local.get('clickychrome_currentSite'))
        .clickychrome_currentSite
      const currentDate = await this.getCurrentDate()
      const currentChart = await this.getCurrentChart()

      await ClickyChrome.Build[page](currentSite, currentDate, currentChart)
    } else {
      console.error(`Build function for page "${page}" not found.`)
      this.loadHtml('<p>Error: Content builder not found.</p>')
    }
  } catch (error) {
    console.error(`Error building page "${page}":`, error)
    this.loadHtml('<p>Error loading content. Please try again.</p>') // Show error in UI
  } finally {
    // Hide loader is now handled within loadHtml or error case
  }
}

/**
 * Loads HTML into #content div
 */
ClickyChrome.Popup.loadHtml = function (html) {
  if (html !== false && typeof html === 'string') {
    // Check if html is a valid string
    $('#content').html(html)
    if (ClickyChrome.Popup.debug) console.log('HTML loaded into #content')
  } else if (html === false) {
    console.warn('loadHtml called with false, indicating potential error upstream.')
    $('#content').html('<p>Failed to load content.</p>') // Provide feedback
  } else {
    console.warn('loadHtml called with invalid content:', html)
    $('#content').html('<p>Invalid content received.</p>')
  }
  this.hideLoader() // Always hide loader after attempting to load
}

/**
 * Handles opening external links
 */
ClickyChrome.Popup.externalLink = function (link) {
  const windowUrl = link.attr('href')
  if (windowUrl) {
    chrome.tabs.create({ url: windowUrl, selected: true })
    if (ClickyChrome.Popup.debug) console.log('Opening external link:', windowUrl)
  } else {
    console.warn('Attempted to open link with no href:', link)
  }
}

// Helper to get current date from storage
ClickyChrome.Popup.getCurrentDate = async function () {
  const data = await chrome.storage.local.get('clickychrome_currentDate')
  return data.clickychrome_currentDate || 'today'
}

// Helper to get current chart from storage
ClickyChrome.Popup.getCurrentChart = async function () {
  const data = await chrome.storage.local.get('clickychrome_currentChart')
  return data.clickychrome_currentChart || 'visitors'
}

/**
 * Sets current date name in the dropdown display
 */
ClickyChrome.Popup.setDateName = function (dateKey) {
  const dateText = this.vars.dateNames[dateKey] || 'Select Date'
  $('#date-select span').text(dateText)
}
/**
 * Sets current chart name in the dropdown display
 */
ClickyChrome.Popup.setChartName = function (chartKey) {
  const chartText = this.vars.chartNames[chartKey] || 'Select Chart'
  $('#chart-select span').text(chartText)
}

/**
 * Updates active tab and which dropdowns are enabled
 */
ClickyChrome.Popup.updateTabAndControls = function (page) {
  $('#main_tabs a').removeClass('active')
  $(`#${page}_tab`).addClass('active')

  switch (page) {
    case 'basics':
      $('#date-select').removeClass('off')
      $('#chart-select').addClass('off')
      break
    case 'visitors':
      $('#date-select').addClass('off') // Visitors is always 'today'
      $('#chart-select').addClass('off')
      this.setDateName('today') // Force display to 'Today'
      break
    case 'charts':
      $('#date-select').addClass('off') // Charts use fixed date ranges (last 30 days)
      $('#chart-select').removeClass('off')
      this.setDateName('last-30-days') // Reflect the fixed range
      break
  }
  if (ClickyChrome.Popup.debug) console.log(`UI controls updated for page: ${page}`)
}

/*
 * MENU SELECTIONS
 * ---------------------------------------------------------------------------*/

ClickyChrome.Popup.siteSelect = async function (siteLink) {
  this.hideMenus()
  const text = siteLink.text()
  const id = siteLink.attr('id') // ID now contains id,key,name string

  if (!id) {
    console.error('Selected site link has no ID attribute.')
    return
  }

  $('#site-select span').text(text)
  $('#site-list a').removeClass('current')
  siteLink.addClass('current')

  try {
    await chrome.storage.local.set({ clickychrome_currentSite: id })
    if (ClickyChrome.Popup.debug) console.log('Current site saved:', id)

    // No need to call background updateTitle here, background listens for storage changes.
    // Background resetGoalStart removed as complex idle/goal timing is gone.

    await this.buildPage(this.vars.currentPage) // Rebuild content for new site
  } catch (error) {
    console.error('Error saving current site:', error)
  }
}

ClickyChrome.Popup.dateSelect = async function (dateLink) {
  this.hideMenus()
  const text = dateLink.text()
  const id = dateLink.attr('id')

  $('#date-select span').text(text)
  $('#date-list a').removeClass('current')
  dateLink.addClass('current')

  try {
    await chrome.storage.local.set({ clickychrome_currentDate: id })
    if (ClickyChrome.Popup.debug) console.log('Current date saved:', id)
    await this.buildPage(this.vars.currentPage) // Rebuild content for new date
  } catch (error) {
    console.error('Error saving current date:', error)
  }
}

ClickyChrome.Popup.chartSelect = async function (chartLink) {
  this.hideMenus()
  const text = chartLink.text()
  const id = chartLink.attr('id')

  $('#chart-select span').text(text)
  $('#chart-list a').removeClass('current')
  chartLink.addClass('current')

  try {
    await chrome.storage.local.set({ clickychrome_currentChart: id })
    if (ClickyChrome.Popup.debug) console.log('Current chart saved:', id)
    await this.buildPage(this.vars.currentPage) // Rebuild content for new chart type
  } catch (error) {
    console.error('Error saving current chart:', error)
  }
}

/*
 * TABS
 * ---------------------------------------------------------------------------*/

ClickyChrome.Popup.basicsTab = async function (tab) {
  this.hideMenus()
  this.vars.currentPage = 'basics'
  this.updateTabAndControls(this.vars.currentPage)
  this.setDateName(await this.getCurrentDate()) // Ensure date display matches storage
  await this.buildPage(this.vars.currentPage)
}

ClickyChrome.Popup.visitorsTab = async function (tab) {
  this.hideMenus()
  this.vars.currentPage = 'visitors'
  // Visitor list is always 'today' - ensure storage reflects this? No, build.js handles it.
  this.updateTabAndControls(this.vars.currentPage)
  await this.buildPage(this.vars.currentPage)
}

ClickyChrome.Popup.chartsTab = async function (tab) {
  this.hideMenus()
  this.vars.currentPage = 'charts'
  this.updateTabAndControls(this.vars.currentPage)
  this.setChartName(await this.getCurrentChart()) // Ensure chart display matches storage
  await this.buildPage(this.vars.currentPage)
}
