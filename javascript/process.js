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
 * Functions to process raw API data into usable formats.
 * Avoids direct use of localStorage or background page variables.
 */

var ClickyChrome = ClickyChrome || {}
ClickyChrome.Process = {}

/**
 * Processes API basics info
 *
 * @param {array} data - Raw API response array for basics types.
 * @returns {object} - Processed info object.
 */
ClickyChrome.Process.basics = function (data) {
  // Assuming data is an array of type objects returned by the API call in build.js
  const findValue = (type) => {
    const item = data.find((d) => d.type === type)
    // Handle cases where data might be missing (e.g., 0 online, no goals yet)
    const value = item?.dates?.[0]?.items?.[0]?.value
    return value !== undefined ? value : 'N/A' // Return 'N/A' or 0 based on context?
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
    // Find data by type, add commas, provide default/indicator if not found
    online: ClickyChrome.Functions.addCommas(findValue('visitors-online') ?? 0),
    visitors: ClickyChrome.Functions.addCommas(findValue('visitors') ?? 0),
    actions: ClickyChrome.Functions.addCommas(findValue('actions') ?? 0),
    averageActions: ClickyChrome.Functions.addCommas(findValue('actions-average') ?? 0),
    time: findValue('time-total-pretty') || 'N/A',
    averageTime: findValue('time-average-pretty') || 'N/A',
    bounce: findValue('bounce-rate') ?? 'N/A', // Bounce rate might be 0
    goals: ClickyChrome.Functions.addCommas(findGoalSum()),
  }

  // console.log("Processed basics info:", info); // Optional debug
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
  if (!items || !Array.isArray(items)) {
    return [] // Return empty array if no items
  }
  if (!siteInfo || siteInfo.length < 1) {
    console.error('Site Info not provided to Process.visitors for link generation.')
    return []
  }
  const siteId = siteInfo[0]

  const processedVisitors = items.map((data) => {
    const visitor = {
      // Links requiring siteId
      ipLink: `https://getclicky.com/stats/visitors?site_id=${siteId}&ip_address=${
        data.ip_address || ''
      }`,
      contentUrl: (() => {
        if (!data.landing_page) return '#' // Handle missing landing page
        try {
          const url = new URL(data.landing_page)
          const path = url.pathname + url.search + url.hash
          // Clicky uses href relative to root
          return `https://getclicky.com/stats/visitors?site_id=${siteId}&href=${encodeURIComponent(
            path
          )}`
        } catch (e) {
          // Fallback if landing_page is not a valid URL (e.g., just a path)
          const path = data.landing_page.startsWith('/')
            ? data.landing_page
            : `/${data.landing_page}`
          return `https://getclicky.com/stats/visitors?site_id=${siteId}&href=${encodeURIComponent(
            path
          )}`
        }
      })(),
      statsUrl: data.stats_url || '#', // Session stats link

      // Visitor details
      flagImg:
        data.country_code && data.country_code !== 'xx' // Clicky uses 'xx' for unknown
          ? `https://static.getclicky.com/media/flags/${data.country_code.toLowerCase()}.gif`
          : chrome.runtime.getURL('/images/icon_world.png'), // Use local fallback
      geoLoc: data.geolocation || 'Unknown Location',
      customName: data.custom?.username || false, // Access nested custom username safely
      goals: !!(data.goals && data.goals.completed), // Check if goals completed exists
      ip: data.ip_address || 'N/A',
      time: data.time_pretty || 'N/A',
      timeTotal: ClickyChrome.Functions.abvTime(data.time_total || 0),
      actions: ClickyChrome.Functions.addCommas(data.actions || 0),
      landed: (() => {
        if (!data.landing_page) return 'N/A'
        try {
          const url = new URL(data.landing_page)
          // Show path, truncate query string visually if needed, but link includes it
          return url.pathname
        } catch (e) {
          // Handle case where landing_page might not be a full URL
          return data.landing_page.split('?')[0]
        }
      })(),

      // Referrer details (check existence)
      referrerDomain: data.referrer_domain || false,
      referrerUrl: data.referrer_url || false,
      referrerSearch: data.referrer_search || false, // Often includes surrounding quotes, consider trimming?
    }
    return visitor
  })
  // console.log("Processed visitors:", processedVisitors); // Optional debug
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
  const newGoalsForNotification = {}
  const updatedLog = { ...currentLog } // Create a copy to modify

  // console.log("Processing goals. Items received:", apiGoalItems, "Current log:", currentLog);

  if (!apiGoalItems || !Array.isArray(apiGoalItems)) {
    return { newGoals: {}, updatedLog } // Return empty if no items
  }

  apiGoalItems.forEach((item) => {
    // We only care about visitors who completed a goal *in this fetch*
    if (!item.goals?.completed || item.goals.completed.length === 0) {
      return // Skip if no goals completed in this item
    }

    const sessionId = item.session_id
    if (!sessionId) {
      console.warn('Goal item missing session_id:', item)
      return // Cannot process without session ID
    }

    const goalNames = item.goals.completed.join(', ') // Combine goal names
    const timestamp = parseInt(item.time, 10) // API time seems to be seconds timestamp

    if (isNaN(timestamp)) {
      console.warn('Goal item missing valid time:', item)
      return // Cannot process without timestamp
    }

    // Check against the log
    if (updatedLog.hasOwnProperty(sessionId)) {
      // Existing session - did the *list* of completed goals change?
      if (updatedLog[sessionId].goals !== goalNames) {
        // Goals changed for this session ID, update log and consider for notification
        if (ClickyChrome.Background?.debug)
          console.log(
            `Goal list changed for session ${sessionId}: "${updatedLog[sessionId].goals}" -> "${goalNames}"`
          )
        updatedLog[sessionId].goals = goalNames
        updatedLog[sessionId].timestamp = timestamp // Update timestamp too
        // Add the *updated* goal info to newGoals for notification
        newGoalsForNotification[sessionId] = {
          cc: item.country_code || 'none',
          ip: item.ip_address || 'N/A',
          visitor: item.custom?.username || item.ip_address || 'Unknown',
          custom: !!item.custom?.username,
          geo: item.geolocation || 'Unknown',
          url: item.stats_url || '#',
          time: item.time_pretty || 'N/A',
          goals: goalNames,
          value: item.goals.revenue || '', // Revenue might be 0 or missing
          id: sessionId,
          timestamp: timestamp,
        }
      } else {
        // Same goals as before, just update timestamp if newer (though offset should prevent old ones)
        if (timestamp > updatedLog[sessionId].timestamp) {
          updatedLog[sessionId].timestamp = timestamp
        }
        // Do NOT add to newGoalsForNotification as it's not a *new* goal completion event we haven't seen
        if (ClickyChrome.Background?.debug)
          console.log(`Session ${sessionId} already logged with same goals, skipping notification.`)
      }
    } else {
      // New session ID - log it and notify
      if (ClickyChrome.Background?.debug) console.log(`New goal session found: ${sessionId}`)
      const newEntry = {
        cc: item.country_code || 'none',
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

  // console.log("Finished processing goals. New for notification:", newGoalsForNotification, "Updated log:", updatedLog);
  return { newGoals: newGoalsForNotification, updatedLog: updatedLog }
}
