/**
 * Clicky Monitor - Popup Script (MV3 Compatible)
 * --------------
 * Attaches to the global ClickyChrome object. Debug logging always on.
 */

ClickyChrome.Popup = {}

$(async function () {
  console.log('Popup script loaded.')

  // --- Event Listeners ---
  $('#site-list').on('click', 'a', async function (e) {
    e.preventDefault()
    await ClickyChrome.Popup.siteSelect($(this))
  })
  $('#date-list').on('click', 'a', async function (e) {
    e.preventDefault()
    await ClickyChrome.Popup.dateSelect($(this))
  })
  $('#chart-list').on('click', 'a', async function (e) {
    e.preventDefault()
    await ClickyChrome.Popup.chartSelect($(this))
  })
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
  $('body').on('click', 'a.external, #chart a', function (e) {
    e.preventDefault()
    ClickyChrome.Popup.externalLink($(this))
  })
  $('#show_options').on('click', function (e) {
    e.preventDefault()
    chrome.runtime.sendMessage({ action: 'showOptions' })
  })
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
    if (!$(e.target).closest('.dropdown').length) {
      ClickyChrome.Popup.hideMenus()
    }
  })

  // Trigger background check on popup open
  chrome.runtime.sendMessage({ action: 'triggerApiCheck' })

  // Initialize the popup
  await ClickyChrome.Popup.init()
})

ClickyChrome.Popup.vars = {
  currentPage: 'basics',
  dateNames: {
    today: 'Today',
    yesterday: 'Yesterday',
    'last-7-days': 'Last 7 Days',
    'last-30-days': 'Last 30 Days',
  },
  chartNames: { visitors: 'Visitors', actions: 'Actions', 'web-browsers': 'Browsers' },
}

ClickyChrome.Popup.init = async function () {
  console.log('Popup init started.')
  try {
    const data = await chrome.storage.local.get([
      'clickychrome_names',
      'clickychrome_ids',
      'clickychrome_keys',
      'clickychrome_currentSite',
      'clickychrome_currentDate',
      'clickychrome_currentChart',
    ])

    if (!data.clickychrome_names || !data.clickychrome_ids || !data.clickychrome_keys) {
      this.hideLoader()
      const html =
        '<p id="no_site">You must <a id="show_options" href="#">add at least one site</a> via the Options page.</p>'
      $('#main_tabs').hide()
      $('#dropdowns').hide()
      $('#content').html(html)
      console.log('No sites configured.')
      return
    }

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
      console.log('Setting default current site:', currentSite)
    }

    await this.buildMenus(nameArray, idArray, keyArray, currentSite)
    this.setDateName(currentDate)
    this.setChartName(currentChart)
    this.updateTabAndControls(this.vars.currentPage)
    await this.buildPage(this.vars.currentPage)
  } catch (error) {
    console.error('Error during popup initialization:', error)
    this.hideLoader()
    $('#content').html('<p id="no_site">An error occurred loading extension data.</p>')
  }
}

ClickyChrome.Popup.buildMenus = async function (nameArray, idArray, keyArray, currentSite) {
  this.showMenuButtons()
  const siteInfo = currentSite.split(',')
  $('#site-select span').text(siteInfo[2])
  $('#site-list').empty()

  for (let i = 0; i < idArray.length; i++) {
    const siteValue = `${idArray[i]},${keyArray[i]},${nameArray[i]}`
    let itemClass = siteInfo[0] === idArray[i] ? ' class="current"' : ''
    const string = `<li><a href="#" id="${siteValue.replace(/"/g, '"')}"${itemClass}>${
      nameArray[i]
    }</a></li>`
    $('#site-list').append(string)
  }
  console.log('Site menu built.')

  const currentDate = await this.getCurrentDate()
  const currentChart = await this.getCurrentChart()
  $('#date-list a').removeClass('current')
  $(`#date-list a#${currentDate}`).addClass('current')
  $('#chart-list a').removeClass('current')
  $(`#chart-list a#${currentChart}`).addClass('current')
}

ClickyChrome.Popup.hideLoader = function () {
  $('#loading').hide()
}
ClickyChrome.Popup.showLoader = function () {
  $('#loading').show()
}
ClickyChrome.Popup.hideMenus = function () {
  $('#site-list, #date-list, #chart-list').hide()
}
ClickyChrome.Popup.showMenuButtons = function () {
  $('#date-select-container, #site-select-container, #chart-select-container').show()
}

ClickyChrome.Popup.buildPage = async function (page) {
  console.log(`Begin "${page}" page build`)
  this.showLoader()
  try {
    // Get common data needed by build functions
    const currentSite = (await chrome.storage.local.get('clickychrome_currentSite'))
      .clickychrome_currentSite
    const currentDate = await this.getCurrentDate()
    const currentChart = await this.getCurrentChart()

    // Call the appropriate build function with the correct arguments
    switch (page) {
      case 'basics':
        if (typeof ClickyChrome.Build?.basics === 'function') {
          await ClickyChrome.Build.basics(currentSite, currentDate)
        } else {
          throw new Error('Build.basics function not found.')
        }
        break
      case 'visitors':
        if (typeof ClickyChrome.Build?.visitors === 'function') {
          // Visitors build function only needs currentSite
          await ClickyChrome.Build.visitors(currentSite)
        } else {
          throw new Error('Build.visitors function not found.')
        }
        break
      case 'charts':
        if (typeof ClickyChrome.Build?.charts === 'function') {
          // Charts build function needs currentSite and currentChart
          await ClickyChrome.Build.charts(currentSite, currentChart)
        } else {
          throw new Error('Build.charts function not found.')
        }
        break
      default:
        console.error(`Build function for page "${page}" not found.`)
        this.loadHtml('<p>Error: Content builder not found.</p>')
        // Skip hiding loader on error? No, loadHtml handles it.
        return // Exit if page type is unknown
    }
  } catch (error) {
    console.error(`Error building page "${page}":`, error)
    this.loadHtml(`<p>Error loading content for ${page}: ${error.message}.</p>`) // Show more specific error
  }
  // Hiding loader is handled by loadHtml or within the Build functions if needed
}

ClickyChrome.Popup.loadHtml = function (html) {
  if (html !== false && typeof html === 'string') {
    $('#content').html(html)
    console.log('HTML loaded into #content')
  } else if (html === false) {
    console.warn('loadHtml called with false, indicating potential error upstream.')
    $('#content').html('<p>Failed to load content.</p>')
  } else {
    console.warn('loadHtml called with invalid content:', html)
    $('#content').html('<p>Invalid content received.</p>')
  }
  this.hideLoader()
}

ClickyChrome.Popup.externalLink = function (link) {
  const windowUrl = link.attr('href')
  if (windowUrl) {
    chrome.tabs.create({ url: windowUrl, selected: true })
    console.log('Opening external link:', windowUrl)
  } else {
    console.warn('Attempted to open link with no href:', link)
  }
}

ClickyChrome.Popup.getCurrentDate = async function () {
  const data = await chrome.storage.local.get('clickychrome_currentDate')
  return data.clickychrome_currentDate || 'today'
}
ClickyChrome.Popup.getCurrentChart = async function () {
  const data = await chrome.storage.local.get('clickychrome_currentChart')
  return data.clickychrome_currentChart || 'visitors'
}
ClickyChrome.Popup.setDateName = function (dateKey) {
  const dateText = this.vars.dateNames[dateKey] || 'Select Date'
  $('#date-select span').text(dateText)
}
ClickyChrome.Popup.setChartName = function (chartKey) {
  const chartText = this.vars.chartNames[chartKey] || 'Select Chart'
  $('#chart-select span').text(chartText)
}
ClickyChrome.Popup.updateTabAndControls = function (page) {
  $('#main_tabs a').removeClass('active')
  $(`#${page}_tab`).addClass('active')
  switch (page) {
    case 'basics':
      $('#date-select').removeClass('off')
      $('#chart-select').addClass('off')
      break
    case 'visitors':
      $('#date-select').addClass('off')
      $('#chart-select').addClass('off')
      this.setDateName('today')
      break
    case 'charts':
      $('#date-select').addClass('off')
      $('#chart-select').removeClass('off')
      this.setDateName('last-30-days')
      break
  }
  console.log(`UI controls updated for page: ${page}`)
}

ClickyChrome.Popup.siteSelect = async function (siteLink) {
  this.hideMenus()
  const text = siteLink.text()
  const id = siteLink.attr('id')
  if (!id) {
    console.error('Selected site link has no ID attribute.')
    return
  }
  $('#site-select span').text(text)
  $('#site-list a').removeClass('current')
  siteLink.addClass('current')
  try {
    await chrome.storage.local.set({ clickychrome_currentSite: id })
    console.log('Current site saved:', id)
    await this.buildPage(this.vars.currentPage)
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
    console.log('Current date saved:', id)
    await this.buildPage(this.vars.currentPage)
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
    console.log('Current chart saved:', id)
    await this.buildPage(this.vars.currentPage)
  } catch (error) {
    console.error('Error saving current chart:', error)
  }
}

ClickyChrome.Popup.basicsTab = async function (tab) {
  this.hideMenus()
  this.vars.currentPage = 'basics'
  this.updateTabAndControls(this.vars.currentPage)
  this.setDateName(await this.getCurrentDate())
  await this.buildPage(this.vars.currentPage)
}
ClickyChrome.Popup.visitorsTab = async function (tab) {
  this.hideMenus()
  this.vars.currentPage = 'visitors'
  this.updateTabAndControls(this.vars.currentPage)
  await this.buildPage(this.vars.currentPage)
}
ClickyChrome.Popup.chartsTab = async function (tab) {
  this.hideMenus()
  this.vars.currentPage = 'charts'
  this.updateTabAndControls(this.vars.currentPage)
  this.setChartName(await this.getCurrentChart())
  await this.buildPage(this.vars.currentPage)
}
