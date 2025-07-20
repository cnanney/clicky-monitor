/**
 * Clicky Monitor - Data Processing Script (MV3 Compatible)
 * --------------
 * Functions to process raw API data into usable formats. Debug logging always on.
 * Attaches to the global ClickyChrome object.
 */

ClickyChrome.Process = {}

/**
 * Processes API basics info
 *
 * @param {array} data - Raw API response array for basics types.
 * @returns {object} - Processed info object.
 */
ClickyChrome.Process.basics = function (data) {
  console.log('[Process] Processing basics data') // Always log
  const findValue = (type) => {
    const item = data.find((d) => d.type === type)
    const value = item?.dates?.[0]?.items?.[0]?.value
    return value !== undefined ? value : 'N/A'
  }
  const findGoalSum = () => {
    const item = data.find((d) => d.type === 'goals')
    let goalCount = 0
    if (item?.dates?.[0]?.items && Array.isArray(item.dates[0].items)) {
      item.dates[0].items.forEach((goalItem) => {
        goalCount += parseFloat(goalItem.value) || 0
      })
    }
    return goalCount
  }

  const info = {
    online: ClickyChrome.Functions.addCommas(findValue('visitors-online') ?? 0),
    visitors: ClickyChrome.Functions.addCommas(findValue('visitors') ?? 0),
    actions: ClickyChrome.Functions.addCommas(findValue('actions') ?? 0),
    averageActions: ClickyChrome.Functions.addCommas(findValue('actions-average') ?? 0),
    time: findValue('time-total-pretty') || 'N/A',
    averageTime: findValue('time-average-pretty') || 'N/A',
    bounce: findValue('bounce-rate') ?? 'N/A',
    goals: ClickyChrome.Functions.addCommas(findGoalSum()),
  }
  console.log('[Process] Processed basics info:', info) // Always log
  return info
}

/**
 * Processes API visitor list info
 *
 * @param {array} items - The 'items' array from the 'visitors-list' API response type.
 * @param {array} siteInfo - Array containing [siteId, siteKey, siteName] for link generation.
 * @returns {array} - Processed visitor info array.
 */
ClickyChrome.Process.visitors = function (items, siteInfo) {
  console.log('[Process] Processing visitors list data') // Always log
  if (!items || !Array.isArray(items)) return []
  if (!siteInfo || siteInfo.length < 1) {
    console.error('[Process] Site Info not provided to Process.visitors for link generation')
    return []
  }
  const siteId = siteInfo[0]

  const processedVisitors = items.map((data) => {
    const visitor = {
      ipLink: `https://clicky.com/stats/visitors?site_id=${siteId}&ip_address=${
        data.ip_address || ''
      }`,
      contentUrl: (() => {
        /* ... (same logic as before) ... */
        if (!data.landing_page) return '#'
        try {
          const url = new URL(data.landing_page)
          const path = url.pathname + url.search + url.hash
          return `https://clicky.com/stats/visitors?site_id=${siteId}&href=${encodeURIComponent(
            path
          )}`
        } catch (e) {
          const path = data.landing_page.startsWith('/')
            ? data.landing_page
            : `/${data.landing_page}`
          return `https://clicky.com/stats/visitors?site_id=${siteId}&href=${encodeURIComponent(
            path
          )}`
        }
      })(),
      statsUrl: data.stats_url || '#',
      flagImg:
        data.country_code && data.country_code !== 'xx'
          ? `https://static.clicky.com/media/flags/${data.country_code.toLowerCase()}.gif`
          : chrome.runtime.getURL('/images/icon_world.png'),
      geoLoc: data.geolocation || 'Unknown Location',
      customName: data.custom?.username || false,
      goals: !!(data.goals && data.goals.completed),
      ip: data.ip_address || 'N/A',
      time: data.time_pretty || 'N/A',
      timeTotal: ClickyChrome.Functions.abvTime(data.time_total || 0),
      actions: ClickyChrome.Functions.addCommas(data.actions || 0),
      landed: (() => {
        /* ... (same logic as before) ... */
        if (!data.landing_page) return 'N/A'
        try {
          const url = new URL(data.landing_page)
          return url.pathname
        } catch (e) {
          return data.landing_page.split('?')[0]
        }
      })(),
      referrerDomain: data.referrer_domain || false,
      referrerUrl: data.referrer_url || false,
      referrerSearch: data.referrer_search || false,
    }
    return visitor
  })
  console.log('[Process] Processed visitors list info:', processedVisitors) // Always log
  return processedVisitors
}

/**
 * Processes API goal info for notifications.
 * Filters out goals already logged/notified within the expiry window.
 *
 * @param {array} apiGoalItems - The 'items' array from API response (likely visitors-list with goal=*).
 * @param {object} currentLog - The current goal log object read from storage.
 * @returns {object} - An object containing { newGoals: {...}, updatedLog: {...} }
 */
ClickyChrome.Process.goals = function (apiGoalItems, currentLog) {
  console.log('[Process] Processing goal data for notifications') // Always log
  const newGoalsForNotification = {}
  const updatedLog = { ...currentLog } // Create a copy to modify

  if (!apiGoalItems || !Array.isArray(apiGoalItems)) {
    return { newGoals: {}, updatedLog }
  }

  apiGoalItems.forEach((item) => {
    if (!item.goals?.completed || item.goals.completed.length === 0) return
    const sessionId = item.session_id
    if (!sessionId) {
      console.warn('[Process] Goal item missing session_id:', item)
      return
    }

    const goalNames = item.goals.completed.join(', ')
    const timestamp = parseInt(item.time, 10)
    if (isNaN(timestamp)) {
      console.warn('[Process] Goal item missing valid time:', item)
      return
    }

    if (updatedLog.hasOwnProperty(sessionId)) {
      if (updatedLog[sessionId].goals !== goalNames) {
        console.log(
          `[Process] Goal list changed for session ${sessionId}: "${updatedLog[sessionId].goals}" -> "${goalNames}"`
        ) // Always log
        updatedLog[sessionId].goals = goalNames
        updatedLog[sessionId].timestamp = timestamp
        newGoalsForNotification[sessionId] = {
          /* ... (assemble goal info as before) ... */ cc: item.country_code || 'none',
          ip: item.ip_address || 'N/A',
          visitor: item.custom?.username || item.ip_address || 'Unknown',
          custom: !!item.custom?.username,
          geo: item.geolocation || 'Unknown',
          url: item.stats_url || '#',
          time: item.time_pretty || 'N/A',
          goals: goalNames,
          value: item.goals.revenue || '',
          id: sessionId,
          timestamp: timestamp,
        }
      } else {
        if (timestamp > updatedLog[sessionId].timestamp) updatedLog[sessionId].timestamp = timestamp
        console.log(`[Process] Session ${sessionId} already logged with same goals, skipping notification`) // Always log
      }
    } else {
      console.log(`[Process] New goal session found: ${sessionId}`) // Always log
      const newEntry = {
        /* ... (assemble goal info as before) ... */ cc: item.country_code || 'none',
        ip: item.ip_address || 'N/A',
        visitor: item.custom?.username || item.ip_address || 'Unknown',
        custom: !!item.custom?.username,
        geo: item.geolocation || 'Unknown',
        url: item.stats_url || '#',
        time: item.time_pretty || 'N/A',
        goals: goalNames,
        value: item.goals.revenue || '',
        id: sessionId,
        timestamp: timestamp,
      }
      updatedLog[sessionId] = newEntry
      newGoalsForNotification[sessionId] = newEntry
    }
  })

  console.log(
    '[Process] Finished processing goals. New for notification:',
    newGoalsForNotification,
    'Updated log:',
    updatedLog
  ) // Always log
  return { newGoals: newGoalsForNotification, updatedLog: updatedLog }
}
