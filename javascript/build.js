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

/**
 * Functions to fetch data and build HTML for the popup content area.
 */

ClickyChrome.Build = {}

// Get debug state asynchronously
async function getBuildDebugState() {
  try {
    // Reuse popup's method if available, otherwise query background directly
    if (typeof ClickyChrome?.Popup?.debug !== 'undefined') {
      return ClickyChrome.Popup.debug
    }
    const response = await chrome.runtime.sendMessage({ action: 'getDebugState' })
    return response?.debug || false
  } catch (error) {
    console.error('Error getting debug state in build.js:', error)
    return false
  }
}

// --- Build Functions ---

ClickyChrome.Build.basics = async function (
  currentSite,
  currentDate /*, currentChart - not needed */
) {
  const debug = await getBuildDebugState()
  if (debug) console.log(`Build basics: site=${currentSite}, date=${currentDate}`)

  if (!currentSite) {
    ClickyChrome.Popup.loadHtml('<p>Error: No site selected for basics.</p>')
    return
  }

  const siteInfo = currentSite.split(',') // [id, key, name]
  const linkURLBase = `https://getclicky.com/stats/home?site_id=${siteInfo[0]}`
  const visitorsURL = `https://getclicky.com/stats/visitors?site_id=${siteInfo[0]}&date=${currentDate}`
  const actionsURL = `https://getclicky.com/stats/visitors-actions?site_id=${siteInfo[0]}&date=${currentDate}`
  const goalsURL = `https://getclicky.com/stats/goals?site_id=${siteInfo[0]}&date=${currentDate}`
  const linkText = `View ${siteInfo[2]} on Clicky`

  // Always include visitors-online for the 'online now' display, even if badge is different
  const apiTypes =
    'visitors-online,visitors,actions,actions-average,time-total-pretty,time-average-pretty,bounce-rate,goals'
  const apiString = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&date=${currentDate}&type=${apiTypes}&output=json&app=clickychrome`

  if (debug) console.log('Basics API URL:', apiString)

  try {
    const response = await fetch(apiString, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()

    if (debug) console.log('Basics API Response:', JSON.stringify(data))

    if (data && Array.isArray(data) && data.length > 0 && data[0]) {
      let html = ''
      if (data[0].error) {
        html = `<p id="no_site">${data[0].error}</p>`
        ClickyChrome.Functions.setBadgeText('ERR') // Use utility function
        console.error('Clicky API Error (Basics):', data[0].error)
      } else {
        // Use the processor function (ensure it's available)
        if (typeof ClickyChrome?.Process?.basics !== 'function') {
          throw new Error('ClickyChrome.Process.basics function not found.')
        }
        const info = ClickyChrome.Process.basics(data)

        html = `<table class="basics_table" cellpadding="0" cellspacing="0">
                    <tr>
                        <td class="left visitors"><a class="inline_external external" href="${visitorsURL}">Visitors</a>`

        // Show 'online now' only for 'today' view
        if (currentDate === 'today') {
          html += `<span class="online">${info.online} online now</span>`
        }

        html += `</td>
                        <td class="value">${info.visitors}</td>
                    </tr>
                    <tr class="alt">
                        <td class="left actions"><a class="inline_external external" href="${actionsURL}">Actions</a></td>
                        <td class="value">${info.actions}</td>
                    </tr>
                    <tr>
                        <td class="left average_actions">Average actions</td>
                        <td class="value">${info.averageActions}</td>
                    </tr>
                    <tr class="alt">
                        <td class="left time">Total time spent</td>
                        <td class="value">${info.time}</td>
                    </tr>
                    <tr>
                        <td class="left time_average">Average time</td>
                        <td class="value">${info.averageTime}</td>
                    </tr>
                    <tr class="alt">
                        <td class="left bounce">Bounce rate</td>
                        <td class="value">${info.bounce}%</td>
                    </tr>
                    <tr>
                        <td class="left goal"><a class="inline_external external" href="${goalsURL}">Goals</a></td>
                        <td class="value">${info.goals}</td>
                    </tr>
                </table>
                <p id="link_to_clicky"><a class="external" href="${linkURLBase}&date=${currentDate}">${linkText}</a></p>`

        // No badge update needed here - background handles badge based on its settings
      }

      if (debug) console.log('Basics HTML built.')
      ClickyChrome.Popup.loadHtml(html)
    } else {
      throw new Error('Invalid or empty data received from Basics API.')
    }
  } catch (error) {
    console.error('Error fetching or processing basics data:', error)
    ClickyChrome.Popup.loadHtml('<p id="no_site">Error loading basic stats. Please try again.</p>')
  }
}

ClickyChrome.Build.visitors = async function (
  currentSite /*, currentDate - always today, currentChart - not needed */
) {
  const debug = await getBuildDebugState()
  if (debug) console.log(`Build visitors: site=${currentSite}`)

  if (!currentSite) {
    ClickyChrome.Popup.loadHtml('<p>Error: No site selected for visitors.</p>')
    return
  }

  const siteInfo = currentSite.split(',') // [id, key, name]
  const linkURL = `https://getclicky.com/stats/visitors?site_id=${siteInfo[0]}` // Link to main visitors page
  const linkText = `View ${siteInfo[2]} on Clicky`
  // Visitor list is always 'today', limit to 5 for the popup
  const apiString = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&type=visitors-list&output=json&limit=5&date=today&app=clickychrome`

  if (debug) console.log('Visitors API URL:', apiString)

  try {
    const response = await fetch(apiString, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()

    if (debug) console.log('Visitors API Response:', JSON.stringify(data))

    if (data && Array.isArray(data) && data.length > 0 && data[0]) {
      let html = ''
      if (data[0].error) {
        html = `<p id="no_site">${data[0].error}</p>`
        console.error('Clicky API Error (Visitors):', data[0].error)
      } else {
        const items = data[0]?.dates?.[0]?.items
        // Use the processor function
        if (typeof ClickyChrome?.Process?.visitors !== 'function') {
          throw new Error('ClickyChrome.Process.visitors function not found.')
        }
        // Pass current site info for link generation within process function
        const info = ClickyChrome.Process.visitors(items || [], siteInfo) // Pass empty array if no items
        const { clickychrome_customName = 'yes' } = await chrome.storage.local.get(
          'clickychrome_customName'
        )

        if (info.length === 0) {
          html += '<h3>No visitors yet today.</h3>'
        } else {
          html += '<h3>Last 5 Visitors Today</h3>'
          let count = 1
          for (const visitor of info) {
            let displayName, displayClass, actionClass
            if (clickychrome_customName === 'yes' && visitor.customName) {
              displayName = visitor.customName
              displayClass = 'visitor_custom'
            } else {
              displayName = visitor.ip
              displayClass = 'visitor_ip'
            }
            actionClass = visitor.goals ? 'visitor_actions visitor_goal' : 'visitor_actions'
            const odd = count % 2 === 0 ? ' alt' : ''

            html += `<div class="visitor${odd}">
                                <div class="visitor_info">
                                    <span class="visitor_flag"><img src="${visitor.flagImg}" alt="${visitor.geoLoc}" title="${visitor.geoLoc}" /></span>
                                    ${visitor.geoLoc}
                                    <span class="${displayClass}"><a class="external" href="${visitor.ipLink}" title="View details for ${displayName}">${displayName}</a></span>
                                </div>
                                <div class="visitor_session">
                                    ${visitor.time} - ${visitor.timeTotal}
                                    <span class="${actionClass}">Actions: <a class="external" href="${visitor.statsUrl}" title="View session actions">${visitor.actions}</a></span>
                                </div>
                                <div class="visitor_landed">
                                    <b>Landed:</b> <a class="external" href="${visitor.contentUrl}" title="View stats for this landing page">${visitor.landed}</a>
                                </div>`

            if (visitor.referrerDomain) {
              html += `<div class="visitor_from">
                                        <b>From:</b> <a class="external" href="${visitor.referrerUrl}" title="Visit referrer URL">${visitor.referrerDomain}</a>`
              if (visitor.referrerSearch) {
                html += ` <span class="visitor_search" title="Search term">(${visitor.referrerSearch})</span>`
              }
              html += '</div>'
            }
            html += '</div>' // close visitor div
            count++
          }
        }
        html += `<p id="link_to_clicky"><a class="external" href="${linkURL}">${linkText}</a></p>`
      }
      if (debug) console.log('Visitors HTML built.')
      ClickyChrome.Popup.loadHtml(html)
    } else {
      throw new Error('Invalid or empty data received from Visitors API.')
    }
  } catch (error) {
    console.error('Error fetching or processing visitors data:', error)
    ClickyChrome.Popup.loadHtml('<p id="no_site">Error loading visitor list. Please try again.</p>')
  }
}

ClickyChrome.Build.charts = async function (
  currentSite,
  /* currentDate - not used */ currentChart
) {
  const debug = await getBuildDebugState()
  if (debug) console.log(`Build charts: site=${currentSite}, chart=${currentChart}`)

  if (!currentSite) {
    ClickyChrome.Popup.loadHtml('<p>Error: No site selected for charts.</p>')
    return
  }

  const siteInfo = currentSite.split(',') // [id, key, name]
  let apiString,
    linkUrl,
    linkText,
    chartTitle = ''
  const apiBase = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&output=json&app=clickychrome`
  linkText = `View ${siteInfo[2]} on Clicky`

  try {
    let responseData
    if (currentChart === 'web-browsers') {
      // --- Pie Chart for Browsers ---
      chartTitle = 'Top Browsers, Last 30 Days'
      linkUrl = `https://getclicky.com/stats/visitors-browsers?site_id=${siteInfo[0]}`
      apiString = `${apiBase}&type=web-browsers&date=last-30-days&limit=11` // Limit 11 to calculate 'Others'

      if (debug) console.log('Browser Chart API URL:', apiString)
      const response = await fetch(apiString, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      responseData = await response.json()
      if (debug) console.log('Browser Chart API Response:', JSON.stringify(responseData))

      if (responseData && responseData[0] && !responseData[0].error) {
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

          // Consolidate 'Others' if more than 10 items
          if (tmpData.length > 10) {
            const othersPercent = tmpData.slice(9).reduce((sum, val) => sum + val, 0)
            tmpData = tmpData.slice(0, 9)
            tmpLabels = tmpLabels.slice(0, 9)
            tmpStatURLs = tmpStatURLs.slice(0, 9) // URLs for top 9

            tmpData.push(othersPercent)
            tmpLabels.push('Others')
            // Link 'Others' to the main browsers page for that period
            tmpStatURLs.push(
              `https://getclicky.com/stats/visitors-browsers?site_id=${siteInfo[0]}&date=last-30-days`
            )
          }

          // Ensure Raphael library is loaded and drawPie exists
          if (typeof ClickyChrome?.Functions?.drawPie !== 'function') {
            throw new Error('ClickyChrome.Functions.drawPie function not found.')
          }

          // Prepare container and draw
          const chartHtml = `<div id="chart_area"><h3>${chartTitle}</h3><div id="chart"></div><p id="link_to_clicky"><a class="external" href="${linkUrl}">${linkText}</a></p></div>`
          ClickyChrome.Popup.loadHtml(chartHtml) // Load container first
          ClickyChrome.Functions.drawPie(tmpData, tmpLabels, tmpStatURLs) // Draw into the container
          if (debug) console.log('Pie chart loaded')
        } else {
          ClickyChrome.Popup.loadHtml('<p>No browser data available for the last 30 days.</p>')
        }
      } else {
        const errorMsg = responseData?.[0]?.error || 'Unknown API error'
        throw new Error(`API Error (Browsers): ${errorMsg}`)
      }
    } else if (currentChart === 'visitors' || currentChart === 'actions') {
      // --- Line Chart for Visitors/Actions ---
      chartTitle = `Daily ${
        currentChart.charAt(0).toUpperCase() + currentChart.slice(1)
      }, Previous 30 Days`
      linkUrl = `https://getclicky.com/stats/${
        currentChart === 'actions' ? 'visitors-actions' : currentChart
      }?site_id=${siteInfo[0]}` // Adjust link for actions
      apiString = `${apiBase}&type=${currentChart}&date=previous-30-days&daily=1`

      if (debug) console.log('Line Chart API URL:', apiString)
      const response = await fetch(apiString, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      responseData = await response.json()
      if (debug) console.log('Line Chart API Response:', JSON.stringify(responseData))

      if (responseData && responseData[0] && !responseData[0].error) {
        const dates = responseData[0]?.dates || []
        if (dates.length > 0 && dates[0]?.items?.length > 0) {
          let tmpData = [],
            tmpLabels = []
          // Data seems to be ordered newest first by API, reverse for graphing oldest->newest
          for (let i = dates.length - 1; i >= 0; i--) {
            tmpData.push(dates[i].items[0].value)
            tmpLabels.push(dates[i].date)
          }

          // Ensure Raphael library is loaded and drawChart exists
          if (typeof ClickyChrome?.Functions?.drawChart !== 'function') {
            throw new Error('ClickyChrome.Functions.drawChart function not found.')
          }

          // Prepare container and draw
          const chartHtml = `<div id="chart_area"><h3>${chartTitle}</h3><div id="chart"></div><p id="link_to_clicky"><a class="external" href="${linkUrl}">${linkText}</a></p></div>`
          ClickyChrome.Popup.loadHtml(chartHtml) // Load container first
          ClickyChrome.Functions.drawChart(tmpData.join(','), tmpLabels.join(','), currentChart)
          if (debug) console.log('Line graph loaded')
        } else {
          ClickyChrome.Popup.loadHtml(
            `<p>No ${currentChart} data available for the previous 30 days.</p>`
          )
        }
      } else {
        const errorMsg = responseData?.[0]?.error || 'Unknown API error'
        throw new Error(`API Error (${currentChart}): ${errorMsg}`)
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
