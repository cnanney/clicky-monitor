/**
 * Clicky Monitor - Content Build Script (MV3 Compatible)
 * --------------
 * Functions to fetch data and build HTML for the popup content area. Debug logging always on.
 */

ClickyChrome.Build = {}

// --- Build Functions ---

ClickyChrome.Build.basics = async function (currentSite, currentDate) {
  console.log(`Build basics: site=${currentSite}, date=${currentDate}`)

  if (!currentSite) {
    ClickyChrome.Popup.loadHtml('<p>Error: No site selected for basics.</p>')
    return
  }

  const siteInfo = currentSite.split(',')
  const linkURLBase = `https://getclicky.com/stats/home?site_id=${siteInfo[0]}`
  const visitorsURL = `https://getclicky.com/stats/visitors?site_id=${siteInfo[0]}&date=${currentDate}`
  const actionsURL = `https://getclicky.com/stats/visitors-actions?site_id=${siteInfo[0]}&date=${currentDate}`
  const goalsURL = `https://getclicky.com/stats/goals?site_id=${siteInfo[0]}&date=${currentDate}`
  const linkText = `View ${siteInfo[2]} on Clicky`
  const apiTypes =
    'visitors-online,visitors,actions,actions-average,time-total-pretty,time-average-pretty,bounce-rate,goals'
  const apiString = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&date=${currentDate}&type=${apiTypes}&output=json&app=${self.API_APP_PARAM}`

  console.log('Basics API URL:', apiString)

  try {
    const response = await fetch(apiString, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = await response.json()
    console.log('Basics API Response (Snippet):', JSON.stringify(data).substring(0, 500) + '...')

    if (data && Array.isArray(data) && data.length > 0) {
      let html = ''
      let apiError = data.find((item) => item && item.error)?.error

      if (apiError) {
        html = `<p id="no_site">${apiError}</p>`
        ClickyChrome.Functions.setBadgeText('ERR') // Use utility function
        console.error('Clicky API Error (Basics):', apiError)
      } else {
        if (typeof ClickyChrome?.Process?.basics !== 'function') {
          throw new Error('ClickyChrome.Process.basics function not found.')
        }
        const info = ClickyChrome.Process.basics(data)
        html = `<table class="basics_table" cellpadding="0" cellspacing="0">
                    <tr><td class="left visitors"><a class="inline_external external" href="${visitorsURL}">Visitors</a>`
        if (currentDate === 'today') {
          html += `<span class="online">${info.online} online now</span>`
        }
        html += `</td><td class="value">${info.visitors}</td></tr>
                    <tr class="alt"><td class="left actions"><a class="inline_external external" href="${actionsURL}">Actions</a></td><td class="value">${info.actions}</td></tr>
                    <tr><td class="left average_actions">Average actions</td><td class="value">${info.averageActions}</td></tr>
                    <tr class="alt"><td class="left time">Total time spent</td><td class="value">${info.time}</td></tr>
                    <tr><td class="left time_average">Average time</td><td class="value">${info.averageTime}</td></tr>
                    <tr class="alt"><td class="left bounce">Bounce rate</td><td class="value">${info.bounce}%</td></tr>
                    <tr><td class="left goal"><a class="inline_external external" href="${goalsURL}">Goals</a></td><td class="value">${info.goals}</td></tr>
                </table>
                <p id="link_to_clicky"><a class="external" href="${linkURLBase}&date=${currentDate}">${linkText}</a></p>`
      }
      console.log('Basics HTML built.')
      ClickyChrome.Popup.loadHtml(html)
    } else {
      throw new Error('Invalid or empty data received from Basics API.')
    }
  } catch (error) {
    console.error('Error fetching or processing basics data:', error)
    ClickyChrome.Popup.loadHtml('<p id="no_site">Error loading basic stats. Please try again.</p>')
  }
}

ClickyChrome.Build.visitors = async function (currentSite) {
  console.log(`Build visitors: site=${currentSite}`)
  if (!currentSite) {
    ClickyChrome.Popup.loadHtml('<p>Error: No site selected for visitors.</p>')
    return
  }

  const siteInfo = currentSite.split(',')
  const linkURL = `https://getclicky.com/stats/visitors?site_id=${siteInfo[0]}`
  const linkText = `View ${siteInfo[2]} on Clicky`
  const apiString = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&type=visitors-list&output=json&limit=5&date=today&app=${self.API_APP_PARAM}`

  console.log('Visitors API URL:', apiString)

  try {
    const response = await fetch(apiString, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = await response.json()
    console.log('Visitors API Response (Snippet):', JSON.stringify(data).substring(0, 500) + '...')

    if (data && Array.isArray(data) && data.length > 0) {
      let html = ''
      let apiError = data.find((item) => item && item.error)?.error

      if (apiError) {
        html = `<p id="no_site">${apiError}</p>`
        console.error('Clicky API Error (Visitors):', apiError)
      } else {
        const items = data[0]?.dates?.[0]?.items
        if (typeof ClickyChrome?.Process?.visitors !== 'function') {
          throw new Error('ClickyChrome.Process.visitors function not found.')
        }
        const info = ClickyChrome.Process.visitors(items || [], siteInfo)
        const { clickychrome_customName = 'yes' } = await chrome.storage.local.get(
          'clickychrome_customName'
        )

        if (info.length === 0) {
          html += '<h3>No visitors yet today.</h3>'
        } else {
          html += '<h3>Last 5 Visitors Today</h3>'
          let count = 1
          for (const visitor of info) {
            let displayName =
              clickychrome_customName === 'yes' && visitor.customName
                ? visitor.customName
                : visitor.ip
            let displayClass =
              clickychrome_customName === 'yes' && visitor.customName
                ? 'visitor_custom'
                : 'visitor_ip'
            let actionClass = visitor.goals ? 'visitor_actions visitor_goal' : 'visitor_actions'
            const odd = count % 2 === 0 ? ' alt' : ''
            html += `<div class="visitor${odd}">
                                <div class="visitor_info"><span class="visitor_flag"><img src="${visitor.flagImg}" alt="${visitor.geoLoc}" title="${visitor.geoLoc}" /></span> ${visitor.geoLoc} <span class="${displayClass}"><a class="external" href="${visitor.ipLink}" title="View details for ${displayName}">${displayName}</a></span></div>
                                <div class="visitor_session">${visitor.time} - ${visitor.timeTotal} <span class="${actionClass}">Actions: <a class="external" href="${visitor.statsUrl}" title="View session actions">${visitor.actions}</a></span></div>
                                <div class="visitor_landed"><b>Landed:</b> <a class="external" href="${visitor.contentUrl}" title="View stats for this landing page">${visitor.landed}</a></div>`
            if (visitor.referrerDomain) {
              html += `<div class="visitor_from"><b>From:</b> <a class="external" href="${visitor.referrerUrl}" title="Visit referrer URL">${visitor.referrerDomain}</a>`
              if (visitor.referrerSearch) {
                html += ` <span class="visitor_search" title="Search term">(${visitor.referrerSearch})</span>`
              }
              html += '</div>'
            }
            html += '</div>'
            count++
          }
        }
        html += `<p id="link_to_clicky"><a class="external" href="${linkURL}">${linkText}</a></p>`
      }
      console.log('Visitors HTML built.')
      ClickyChrome.Popup.loadHtml(html)
    } else {
      throw new Error('Invalid or empty data received from Visitors API.')
    }
  } catch (error) {
    console.error('Error fetching or processing visitors data:', error)
    ClickyChrome.Popup.loadHtml('<p id="no_site">Error loading visitor list. Please try again.</p>')
  }
}

ClickyChrome.Build.charts = async function (currentSite, currentChart) {
  console.log(`Build charts: site=${currentSite}, chart=${currentChart}`)
  if (!currentSite) {
    ClickyChrome.Popup.loadHtml('<p>Error: No site selected for charts.</p>')
    return
  }

  const siteInfo = currentSite.split(',')
  let apiString,
    linkUrl,
    linkText,
    chartTitle = ''
  const apiBase = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&output=json&app=${self.API_APP_PARAM}`
  linkText = `View ${siteInfo[2]} on Clicky`

  try {
    let responseData
    if (currentChart === 'web-browsers') {
      chartTitle = 'Top Browsers, Last 30 Days'
      linkUrl = `https://getclicky.com/stats/visitors-browsers?site_id=${siteInfo[0]}`
      apiString = `${apiBase}&type=web-browsers&date=last-30-days&limit=11`
      console.log('Browser Chart API URL:', apiString)
      const response = await fetch(apiString, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      responseData = await response.json()
      console.log(
        'Browser Chart API Response (Snippet):',
        JSON.stringify(responseData).substring(0, 500) + '...'
      )

      let apiError = responseData.find((item) => item && item.error)?.error
      if (apiError) throw new Error(`API Error (Browsers): ${apiError}`)

      if (responseData && responseData[0]) {
        const items = responseData[0]?.dates?.[0]?.items || []
        if (items.length > 0) {
          let tmpData = [],
            tmpLabels = [],
            tmpStatURLs = []
          items.forEach((item) => {
            tmpData.push(Number(item.value_percent))
            tmpLabels.push(item.title)
            tmpStatURLs.push(item.stats_url)
          })
          if (tmpData.length > 10) {
            const othersPercent = tmpData.slice(9).reduce((sum, val) => sum + val, 0)
            tmpData = tmpData.slice(0, 9)
            tmpLabels = tmpLabels.slice(0, 9)
            tmpStatURLs = tmpStatURLs.slice(0, 9)
            tmpData.push(othersPercent)
            tmpLabels.push('Others')
            tmpStatURLs.push(
              `https://getclicky.com/stats/visitors-browsers?site_id=${siteInfo[0]}&date=last-30-days`
            )
          }
          if (typeof ClickyChrome?.Functions?.drawPie !== 'function')
            throw new Error('ClickyChrome.Functions.drawPie function not found.')
          const chartHtml = `<div id="chart_area"><h3>${chartTitle}</h3><div id="chart"></div><p id="link_to_clicky"><a class="external" href="${linkUrl}">${linkText}</a></p></div>`
          ClickyChrome.Popup.loadHtml(chartHtml)
          ClickyChrome.Functions.drawPie(tmpData, tmpLabels, tmpStatURLs)
          console.log('Pie chart loaded')
        } else {
          ClickyChrome.Popup.loadHtml('<p>No browser data available for the last 30 days.</p>')
        }
      } else {
        throw new Error('Invalid response format from Browser API.')
      }
    } else if (currentChart === 'visitors' || currentChart === 'actions') {
      chartTitle = `Daily ${
        currentChart.charAt(0).toUpperCase() + currentChart.slice(1)
      }, Previous 30 Days`
      linkUrl = `https://getclicky.com/stats/${
        currentChart === 'actions' ? 'visitors-actions' : currentChart
      }?site_id=${siteInfo[0]}`
      apiString = `${apiBase}&type=${currentChart}&date=previous-30-days&daily=1`
      console.log('Line Chart API URL:', apiString)
      const response = await fetch(apiString, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      responseData = await response.json()
      console.log(
        'Line Chart API Response (Snippet):',
        JSON.stringify(responseData).substring(0, 500) + '...'
      )

      let apiError = responseData.find((item) => item && item.error)?.error
      if (apiError) throw new Error(`API Error (${currentChart}): ${apiError}`)

      if (responseData && responseData[0]) {
        const dates = responseData[0]?.dates || []
        if (dates.length > 0 && dates[0]?.items?.length > 0) {
          let tmpData = [],
            tmpLabels = []
          for (let i = dates.length - 1; i >= 0; i--) {
            tmpData.push(dates[i].items[0].value)
            tmpLabels.push(dates[i].date)
          }
          if (typeof ClickyChrome?.Functions?.drawChart !== 'function')
            throw new Error('ClickyChrome.Functions.drawChart function not found.')
          const chartHtml = `<div id="chart_area"><h3>${chartTitle}</h3><div id="chart"></div><p id="link_to_clicky"><a class="external" href="${linkUrl}">${linkText}</a></p></div>`
          ClickyChrome.Popup.loadHtml(chartHtml)
          ClickyChrome.Functions.drawChart(tmpData.join(','), tmpLabels.join(','), currentChart)
          console.log('Line graph loaded')
        } else {
          ClickyChrome.Popup.loadHtml(
            `<p>No ${currentChart} data available for the previous 30 days.</p>`
          )
        }
      } else {
        throw new Error(`Invalid response format from ${currentChart} API.`)
      }
    } else {
      throw new Error(`Unknown chart type requested: ${currentChart}`)
    }
  } catch (error) {
    console.error(`Error fetching or processing chart data (${currentChart}):`, error)
    ClickyChrome.Popup.loadHtml(
      `<p id="no_site">Error loading chart data: ${error.message}. Please try again.</p>`
    )
  }
}
