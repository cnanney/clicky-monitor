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
 * Service Worker based background script.
 */

// Import utility scripts (assuming they don't have conflicting globals or DOM reliance)
try {
  importScripts('javascript/functions.js', 'javascript/process.js')
} catch (e) {
  console.error('Error importing scripts:', e)
}

const ClickyChrome = ClickyChrome || {}
ClickyChrome.Background = {}

ClickyChrome.Background.debug = false // log events to console

// --- Constants ---
const ALARM_CHECK_API = 'checkApi'
const ALARM_CLEAN_GOALS = 'cleanGoalLog'
const DEFAULT_CHECK_INTERVAL_MINUTES = 5 // Check API every 5 minutes
const GOAL_LOG_CLEAN_INTERVAL_MINUTES = 15 // Clean goal log every 15 minutes
const GOAL_LOG_EXPIRY_SECONDS = 900 // 15 minutes
const GOAL_NOTIFICATION_TIMEOUT_MS = 10000 // Default 10 seconds for notification visibility (though not strictly enforced by API)

// --- State (managed via chrome.storage.local) ---
// We retrieve state as needed instead of keeping it in memory

// --- Initialization and Event Listeners ---

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Clicky Monitor: onInstalled event.')
  await initializeDefaults()
  await setupContextMenu()
  await setupAlarms()
  await checkSpy() // Initial check on install/update
})

chrome.runtime.onStartup.addListener(async () => {
  console.log('Clicky Monitor: onStartup event.')
  // Alarms should persist, but we can ensure they are set up correctly
  await setupAlarms()
  // Optional: Run an initial check on browser startup
  // await checkSpy();
})

chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('Clicky Monitor: Alarm fired:', alarm.name)
  if (alarm.name === ALARM_CHECK_API) {
    checkSpy()
  } else if (alarm.name === ALARM_CLEAN_GOALS) {
    cleanGoalLog()
  }
})

// Listen for changes in storage (e.g., options saved)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    console.log('Clicky Monitor: Storage changed:', changes)
    let needsApiCheck = false
    let needsContextMenuUpdate = false

    if (
      changes.clickychrome_currentSite ||
      changes.clickychrome_spyType ||
      changes.clickychrome_goalNotification
    ) {
      needsApiCheck = true
    }
    if (changes.clickychrome_urls || changes.clickychrome_ids) {
      needsContextMenuUpdate = true
    }
    if (changes.clickychrome_badgeColor) {
      updateBadgeColor()
    }

    if (needsApiCheck) {
      console.log('Storage change triggers API check.')
      checkSpy() // Re-check API immediately on relevant option changes
    }
    if (needsContextMenuUpdate) {
      console.log('Storage change triggers context menu update.')
      setupContextMenu() // Re-create/update context menu
    }
  }
})

// Listen for messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showOptions') {
    ClickyChrome.Background.showOptions()
    sendResponse({ status: 'Options tab opened/focused' })
  } else if (message.action === 'triggerApiCheck') {
    // Used by popup init/refresh potentially
    console.log('Received triggerApiCheck message')
    checkSpy()
    sendResponse({ status: 'API check triggered' })
  } else if (message.action === 'createSampleNotification') {
    createSampleNotification()
    sendResponse({ status: 'Sample notification triggered' })
  } else if (message.action === 'getDebugState') {
    sendResponse({ debug: ClickyChrome.Background.debug })
  } else if (message.action === 'log') {
    // Allow other scripts to log via the background console
    console.log('LOG from', sender.url, ':', message.data)
    sendResponse({ status: 'Logged' })
  }
  // Keep the message channel open for asynchronous responses if needed
  // return true;
})

// --- Core Functions ---

async function initializeDefaults() {
  console.log('Initializing default settings...')
  const defaults = {
    clickychrome_badgeColor: '0,0,0,200',
    clickychrome_currentChart: 'visitors',
    clickychrome_customName: 'yes', // This seems related to visitor display, keep for now
    clickychrome_spyType: 'online',
    clickychrome_goalNotification: 'no',
    clickychrome_goalTimeout: '10', // Stored as string, used as number
    clickychrome_goalLog: {},
    clickychrome_startTime: new Date().getTime(), // Used for goal time offset calculation
  }

  try {
    const currentSettings = await chrome.storage.local.get(Object.keys(defaults))
    const settingsToSet = {}
    for (const key in defaults) {
      if (currentSettings[key] === undefined) {
        settingsToSet[key] = defaults[key]
        console.log(`Setting default for ${key}`)
      }
    }

    // Handle the old migration from ids/names to urls if necessary
    if (
      currentSettings.clickychrome_urls === undefined &&
      currentSettings.clickychrome_ids !== undefined
    ) {
      const names = (currentSettings.clickychrome_names || '').split(',')
      const blankUrls = Array(names.length).fill('')
      settingsToSet['clickychrome_urls'] = blankUrls.join(',')
      console.log('Migrating old settings: creating blank URLs array.')
    }

    if (Object.keys(settingsToSet).length > 0) {
      await chrome.storage.local.set(settingsToSet)
      console.log('Defaults set:', settingsToSet)
    }

    await updateBadgeColor() // Set initial badge color
  } catch (error) {
    console.error('Error initializing defaults:', error)
  }
}

async function setupAlarms() {
  console.log('Setting up alarms...')
  try {
    // Clear existing alarms to avoid duplicates if setup is called multiple times
    // await chrome.alarms.clear(ALARM_CHECK_API);
    // await chrome.alarms.clear(ALARM_CLEAN_GOALS);

    // Main API check alarm
    await chrome.alarms.create(ALARM_CHECK_API, {
      delayInMinutes: 0.1, // Fire quickly the first time
      periodInMinutes: DEFAULT_CHECK_INTERVAL_MINUTES,
    })
    console.log(
      `Alarm '${ALARM_CHECK_API}' created/updated. Interval: ${DEFAULT_CHECK_INTERVAL_MINUTES} minutes.`
    )

    // Goal log cleaning alarm
    await chrome.alarms.create(ALARM_CLEAN_GOALS, {
      delayInMinutes: 1, // Start cleaning after 1 minute
      periodInMinutes: GOAL_LOG_CLEAN_INTERVAL_MINUTES,
    })
    console.log(
      `Alarm '${ALARM_CLEAN_GOALS}' created/updated. Interval: ${GOAL_LOG_CLEAN_INTERVAL_MINUTES} minutes.`
    )
  } catch (error) {
    console.error('Error setting up alarms:', error)
  }
}

async function updateBadgeColor() {
  try {
    const data = await chrome.storage.local.get('clickychrome_badgeColor')
    const colorString = data.clickychrome_badgeColor || '0,0,0,200'
    const colors = colorString.split(',').map(Number)
    if (colors.length === 4) {
      await chrome.action.setBadgeBackgroundColor({
        color: [colors[0], colors[1], colors[2], colors[3]],
      })
      if (ClickyChrome.Background.debug) console.log('Badge color updated:', colors)
    } else {
      console.error('Invalid badge color format in storage:', colorString)
    }
  } catch (error) {
    console.error('Error setting badge color:', error)
  }
}

/**
 * Opens ClickyChrome options page, focuses if already open.
 */
ClickyChrome.Background.showOptions = async () => {
  const optionsUrl = chrome.runtime.getURL('options.html')
  try {
    const tabs = await chrome.tabs.query({ url: optionsUrl })
    if (tabs.length > 0) {
      // Focus the first found options tab
      await chrome.tabs.update(tabs[0].id, { active: true })
      await chrome.windows.update(tabs[0].windowId, { focused: true })
      console.log('Focused existing options tab:', tabs[0].id)
    } else {
      // Create a new options tab
      const newTab = await chrome.tabs.create({ url: optionsUrl, selected: true })
      console.log('Created new options tab:', newTab.id)
    }
  } catch (error) {
    console.error('Error showing options page:', error)
    // Fallback if query fails
    try {
      await chrome.tabs.create({ url: optionsUrl, selected: true })
    } catch (createError) {
      console.error('Error creating options tab as fallback:', createError)
    }
  }
}

/**
 * Fetch data from Clicky API
 */
async function checkSpy() {
  if (ClickyChrome.Background.debug) console.log('Spy: Fetching API data...')

  try {
    const settings = await chrome.storage.local.get([
      'clickychrome_currentSite',
      'clickychrome_spyType',
      'clickychrome_goalNotification',
      'clickychrome_startTime', // Get startTime for goal offset
    ])

    if (!settings.clickychrome_currentSite) {
      console.log('Spy: No current site selected. Setting title.')
      ClickyChrome.Functions.setTitle('ClickyChrome - No Site Selected')
      ClickyChrome.Functions.setBadgeText('') // Clear badge if no site
      // Optionally open options page if truly unconfigured
      // const allSettings = await chrome.storage.local.get(['clickychrome_ids']);
      // if (!allSettings.clickychrome_ids) {
      //     ClickyChrome.Background.showOptions();
      // }
      return
    }

    const siteInfo = settings.clickychrome_currentSite.split(',') // [id, key, name]
    const spyType = settings.clickychrome_spyType || 'online'
    const goalNotificationsEnabled = settings.clickychrome_goalNotification === 'yes'
    const startTime = settings.clickychrome_startTime || new Date().getTime()

    // Calculate goal time offset (similar logic to original)
    const now = new Date().getTime()
    const elapsedSeconds = Math.floor((now - startTime) / 1000)
    let goalTimeOffset = 600 // Max offset 10 minutes
    if (elapsedSeconds < 600) {
      goalTimeOffset = elapsedSeconds + 30 // Add 30s buffer like original
    }
    if (ClickyChrome.Background.debug) console.log('Goal time offset calculated:', goalTimeOffset)

    // Base API URL structure
    let apiUrl = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&date=today&output=json&app=clickychrome`

    // Determine API types based on spyType and goal notification settings
    let types = []
    switch (spyType) {
      case 'online':
        types.push('visitors-online')
        break
      case 'goals':
        types.push('goals')
        break
      case 'visitors':
        types.push('visitors')
        break
      default:
        types.push('visitors-online') // Fallback
    }

    if (goalNotificationsEnabled) {
      // If goal notifications are on, always fetch visitors-list and goals with offset
      if (!types.includes('goals')) {
        // Avoid duplicate if spyType is 'goals'
        types.push('goals')
      }
      types.push('visitors-list')
      apiUrl += `&goal=*&time_offset=${goalTimeOffset}`
    }

    apiUrl += `&type=${types.join(',')}`

    // Update browser action title
    updateTitle(siteInfo, spyType)

    if (ClickyChrome.Background.debug) console.log('API URL:', apiUrl)

    const response = await fetch(apiUrl, { cache: 'no-store' }) // Prevent caching

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()

    if (ClickyChrome.Background.debug) console.log('API Response Data:', JSON.stringify(data))

    if (data && Array.isArray(data) && data.length > 0 && data[0]) {
      // Check for API error reported within the JSON
      if (data[0].error) {
        console.error('Clicky API Error:', data[0].error)
        ClickyChrome.Functions.setTitle(`Error: ${data[0].error}`)
        ClickyChrome.Functions.setBadgeText('ERR')
      } else {
        // Process main spy type for badge
        // Find the data corresponding to the spyType
        let badgeData = null
        let goalData = null
        for (const item of data) {
          if (item.type === spyType) {
            badgeData = item
          }
          // Find goal data if notifications are enabled (it might be the second item)
          if (
            goalNotificationsEnabled &&
            (item.type === 'goals' || item.type === 'visitors-list')
          ) {
            // Need to refine this - how to reliably get goal completion data?
            // Assuming visitors-list contains goal info if goal=* is used
            if (item.type === 'visitors-list' && item.dates?.[0]?.items) {
              goalData = item.dates[0].items
            } else if (item.type === 'goals' && item.dates?.[0]?.items && !goalData) {
              // Fallback? Less ideal as it might not have visitor details
              // goalData = item.dates[0].items;
            }
          }
        }

        if (badgeData && badgeData.dates?.[0]?.items?.[0]?.value) {
          ClickyChrome.Functions.setBadgeNum(badgeData.dates[0].items[0].value)
          if (ClickyChrome.Background.debug)
            console.log(`Badge updated for ${spyType}:`, badgeData.dates[0].items[0].value)
        } else {
          // Handle cases where specific data might be missing (e.g., 0 goals)
          if (spyType === 'goals') {
            ClickyChrome.Functions.setBadgeNum(0) // Show 0 if no goal data found for badge
          } else if (
            spyType === 'online' &&
            badgeData?.dates?.[0]?.items?.[0]?.value !== undefined
          ) {
            ClickyChrome.Functions.setBadgeNum(badgeData.dates[0].items[0].value) // Handle 0 online
          } else {
            console.warn(`Could not find value for badge type '${spyType}' in API response.`)
            // Don't set badge text to avoid confusion, or set to '?'
            ClickyChrome.Functions.setBadgeText('?')
          }
        }

        // Process goal notifications if enabled and data is present
        if (goalNotificationsEnabled && goalData && goalData.length > 0) {
          if (ClickyChrome.Background.debug)
            console.log('Goal data found for potential notification:', goalData)
          await processAndCreateNotifications(goalData)
        } else if (goalNotificationsEnabled) {
          if (ClickyChrome.Background.debug)
            console.log('Goal notifications enabled, but no new goal data found.')
        }
      }
    } else {
      console.warn('Received empty or invalid data from Clicky API.')
      ClickyChrome.Functions.setBadgeText('?')
    }
  } catch (error) {
    console.error('Error in checkSpy:', error)
    ClickyChrome.Functions.setTitle('Clicky Monitor - API Error')
    ClickyChrome.Functions.setBadgeText('ERR')
  }
}

/**
 * Updates extension title based on current settings.
 */
async function updateTitle(siteInfo, spyType) {
  const titleInfo = {
    online: { titleString: 'Visitors Online: ' },
    goals: { titleString: 'Goals Completed: ' },
    visitors: { titleString: 'Visitors Today: ' },
  }
  const siteName = siteInfo[2] || 'Unknown Site'
  const titlePrefix = titleInfo[spyType]?.titleString || 'Stats: '
  ClickyChrome.Functions.setTitle(titlePrefix + siteName)
}

/**
 * Processes goal data and creates notifications if new goals are found.
 */
async function processAndCreateNotifications(apiGoalItems) {
  if (ClickyChrome.Background.debug) console.log('Processing goal data for notifications...')

  try {
    const {
      clickychrome_goalLog: currentLog = {},
      clickychrome_goalTimeout: timeoutString = '10',
    } = await chrome.storage.local.get(['clickychrome_goalLog', 'clickychrome_goalTimeout'])

    const processedData = ClickyChrome.Process.goals(apiGoalItems, currentLog) // Pass current log

    if (processedData.newGoals && Object.keys(processedData.newGoals).length > 0) {
      const newGoals = processedData.newGoals
      const updatedLog = processedData.updatedLog

      if (ClickyChrome.Background.debug) {
        console.log('New goals found for notification:', newGoals)
        console.log('Updated goal log:', updatedLog)
      }

      // Store the updated log immediately
      await chrome.storage.local.set({ clickychrome_goalLog: updatedLog })

      // --- Create Simplified Notification ---
      const goalKeys = Object.keys(newGoals)
      const firstGoal = newGoals[goalKeys[0]] // Use the first new goal for simplicity
      let notificationTitle = 'Goal Completed!'
      let notificationMessage = `${firstGoal.goals} by ${firstGoal.visitor}`
      let notificationItems = [] // For list format

      if (goalKeys.length > 1) {
        notificationTitle = `${goalKeys.length} Goals Completed!`
        // Create list items for notification
        notificationItems = goalKeys
          .map((key) => {
            const goal = newGoals[key]
            return { title: goal.goals, message: `by ${goal.visitor} (${goal.geo})` }
          })
          .slice(0, 5) // Max 5 items in list notification
        notificationMessage = `${notificationItems.length} new goals. See list.` // Fallback message
      }

      const iconUrl = chrome.runtime.getURL('images/clicky_icon_48.png')
      const notificationId = `clickyGoal_${Date.now()}` // Unique ID

      const notificationOptions = {
        type: goalKeys.length > 1 ? 'list' : 'basic',
        iconUrl: iconUrl,
        title: notificationTitle,
        message: notificationMessage,
        priority: 1, // 0 to 2
        requireInteraction: false, // Auto-close after system default or timeout
        // eventTime: Date.now() // Optional timestamp
      }

      if (goalKeys.length > 1 && notificationItems.length > 0) {
        notificationOptions.items = notificationItems
      }

      // Add button to view stats (optional)
      // notificationOptions.buttons = [{ title: 'View Visitor Stats', iconUrl: chrome.runtime.getURL('images/icon_stats.png') }]; // Example button

      chrome.notifications.create(notificationId, notificationOptions, (createdId) => {
        if (chrome.runtime.lastError) {
          console.error('Error creating notification:', chrome.runtime.lastError)
        } else {
          if (ClickyChrome.Background.debug) console.log('Notification created:', createdId)

          // --- Handle Notification Click (Optional) ---
          // Need a persistent listener for clicks
          // Store the goal URL associated with the notification ID if needed
          chrome.storage.local.set({ [`notification_url_${createdId}`]: firstGoal.url })
        }
      })

      // // Auto-clear notification (alternative to requireInteraction: false)
      // const timeoutSeconds = parseInt(timeoutString, 10) || 10;
      // setTimeout(() => {
      //     chrome.notifications.clear(notificationId, (wasCleared) => {
      //         if (ClickyChrome.Background.debug) console.log(`Notification ${notificationId} cleared after timeout: ${wasCleared}`);
      //         chrome.storage.local.remove(`notification_url_${notificationId}`); // Clean up stored URL
      //     });
      // }, timeoutSeconds * 1000);
    } else {
      if (ClickyChrome.Background.debug) console.log('No new, unique goals found to notify.')
      // If the log was potentially modified (e.g., goal name changed), save it
      if (
        processedData.updatedLog &&
        JSON.stringify(processedData.updatedLog) !== JSON.stringify(currentLog)
      ) {
        await chrome.storage.local.set({ clickychrome_goalLog: processedData.updatedLog })
        if (ClickyChrome.Background.debug)
          console.log('Goal log updated even without new notifications.')
      }
    }
  } catch (error) {
    console.error('Error processing or creating notifications:', error)
  }
}

// Listen for notification clicks (add this listener at the top level)
chrome.notifications.onClicked.addListener(async (notificationId) => {
  console.log(`Notification clicked: ${notificationId}`)
  if (notificationId.startsWith('clickyGoal_')) {
    const storageKey = `notification_url_${notificationId}`
    try {
      const data = await chrome.storage.local.get(storageKey)
      if (data[storageKey]) {
        chrome.tabs.create({ url: data[storageKey], selected: true })
        // Clean up the stored URL after opening
        await chrome.storage.local.remove(storageKey)
      } else {
        console.warn('No URL found for clicked notification:', notificationId)
      }
      // Clear the notification after click
      chrome.notifications.clear(notificationId)
    } catch (error) {
      console.error('Error handling notification click:', error)
    }
  } else if (notificationId === 'clickySample') {
    console.log('Sample notification clicked.')
    chrome.notifications.clear(notificationId)
  }
})

// Optional: Listen for button clicks if buttons are added
// chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
//   console.log(`Button ${buttonIndex} clicked on notification ${notificationId}`);
//   // Handle button actions
//   chrome.notifications.clear(notificationId);
// });

/**
 * Creates sample desktop notification.
 */
function createSampleNotification() {
  const notificationId = 'clickySample'
  const notificationOptions = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('images/clicky_icon_48.png'),
    title: 'Sample Clicky Goal',
    message: "Example Visitor completed 'Sign Up'",
    priority: 1,
  }
  chrome.notifications.create(notificationId, notificationOptions, (id) => {
    if (chrome.runtime.lastError) {
      console.error('Error creating sample notification:', chrome.runtime.lastError)
    } else {
      if (ClickyChrome.Background.debug) console.log('Sample notification created:', id)
    }
  })
}

/**
 * Garbage collection for goal log stored in chrome.storage.local.
 */
async function cleanGoalLog() {
  if (ClickyChrome.Background.debug) console.log('Cleaning goal log...')
  try {
    const data = await chrome.storage.local.get('clickychrome_goalLog')
    const goalLog = data.clickychrome_goalLog || {}
    const nowSeconds = Math.floor(new Date().getTime() / 1000)
    let changed = false
    let deletedCount = 0

    for (const id in goalLog) {
      if (goalLog.hasOwnProperty(id)) {
        // Ensure timestamp exists and is a number
        const timestamp = Number(goalLog[id]?.timestamp)
        if (!isNaN(timestamp) && nowSeconds - timestamp > GOAL_LOG_EXPIRY_SECONDS) {
          delete goalLog[id]
          changed = true
          deletedCount++
          if (ClickyChrome.Background.debug) console.log(`Goal log entry #${id} deleted (expired).`)
        } else if (isNaN(timestamp)) {
          console.warn(`Goal log entry #${id} has invalid timestamp, removing.`)
          delete goalLog[id]
          changed = true
          deletedCount++
        }
      }
    }

    if (changed) {
      await chrome.storage.local.set({ clickychrome_goalLog: goalLog })
      if (ClickyChrome.Background.debug)
        console.log(`Goal log cleaned. ${deletedCount} entries removed.`)
    } else {
      if (ClickyChrome.Background.debug) console.log('Goal log clean. No expired entries found.')
    }
  } catch (error) {
    console.error('Error cleaning goal log:', error)
  }
}

// --- Context Menu ---
let currentContextMenuId = null

async function setupContextMenu() {
  console.log('Setting up context menu...')
  try {
    // Remove existing menu item before creating/updating
    if (currentContextMenuId) {
      try {
        await chrome.contextMenus.remove(currentContextMenuId)
        if (ClickyChrome.Background.debug)
          console.log('Removed existing context menu:', currentContextMenuId)
        currentContextMenuId = null
      } catch (removeError) {
        // Ignore error if menu ID doesn't exist (e.g., after browser restart)
        if (ClickyChrome.Background.debug)
          console.log('Context menu removal error (likely harmless):', removeError.message)
      }
    }

    const data = await chrome.storage.local.get(['clickychrome_urls', 'clickychrome_ids'])
    const urlsString = data.clickychrome_urls
    const idsString = data.clickychrome_ids

    if (!urlsString || !idsString) {
      if (ClickyChrome.Background.debug)
        console.log('Context menu not created: Missing URLs or IDs in storage.')
      return // Don't create menu if no sites configured
    }

    const urls = urlsString.split(',')
    const patterns = []
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim()
      if (url !== '') {
        // Basic pattern matching, ensure it's treated as a hostname
        const clean = url.replace(/^((?:[a-z][a-z0-9+\-.]*:)?\/\/)?(www\.)?/gi, '')
        patterns.push(`*://${clean}/*`)
        patterns.push(`*://www.${clean}/*`)
      }
    }

    if (patterns.length > 0) {
      currentContextMenuId = await chrome.contextMenus.create({
        id: 'clickyViewPageStats', // Static ID is better for updates
        title: 'View page stats on Clicky',
        contexts: ['page', 'link'], // Show on page and links
        documentUrlPatterns: patterns,
        targetUrlPatterns: patterns, // Apply to link targets too
      })
      if (ClickyChrome.Background.debug)
        console.log(
          `Context menu created/updated. ID: ${currentContextMenuId}, Patterns: ${patterns.join(
            ', '
          )}`
        )
    } else {
      if (ClickyChrome.Background.debug)
        console.log('Context menu not created: No valid URL patterns found.')
    }
  } catch (error) {
    console.error('Error setting up context menu:', error)
  }
}

// Context menu click handler (needs to be top-level)
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'clickyViewPageStats') {
    console.log('Context menu clicked:', info)
    const pageUrl = info.pageUrl || info.linkUrl // Use linkUrl if clicked on a link
    if (!pageUrl) {
      console.warn('No URL found in context menu click info.')
      return
    }

    try {
      const data = await chrome.storage.local.get(['clickychrome_urls', 'clickychrome_ids'])
      if (!data.clickychrome_urls || !data.clickychrome_ids) return

      const urlArray = data.clickychrome_urls.split(',')
      const idArray = data.clickychrome_ids.split(',')

      for (let i = 0; i < urlArray.length; i++) {
        const siteDomain = urlArray[i].trim()
        if (siteDomain === '') continue

        // More robust matching: check if pageUrl hostname contains the siteDomain
        try {
          const pageHostname = new URL(pageUrl).hostname.replace(/^www\./i, '')
          const configuredHostname = siteDomain.replace(/^www\./i, '')
          if (pageHostname === configuredHostname) {
            const siteId = idArray[i]
            if (ClickyChrome.Background.debug)
              console.log(`Context matched ${siteDomain}, ID: ${siteId}`)

            // Construct the Clicky stats URL for the specific page path
            const pagePath =
              new URL(pageUrl).pathname + new URL(pageUrl).search + new URL(pageUrl).hash
            // Clicky uses href parameter relative to root
            const contentUrl = `https://getclicky.com/stats/visitors?site_id=${siteId}&href=${encodeURIComponent(
              pagePath
            )}`

            await chrome.tabs.create({ url: contentUrl, selected: true })
            return // Stop after first match
          }
        } catch (urlError) {
          console.warn('Could not parse URL for context matching:', pageUrl, urlError)
          // Simple regex fallback (less reliable)
          const cleanPattern = siteDomain.replace(/^((?:[a-z][a-z0-9+\-.]*:)?\/\/)?(www\.)?/gi, '')
          const re = new RegExp(
            `https://${cleanPattern}/|http://${cleanPattern}/|https://www.${cleanPattern}/|http://www.${cleanPattern}/`,
            'i'
          )
          if (re.test(pageUrl)) {
            const siteId = idArray[i]
            if (ClickyChrome.Background.debug)
              console.log(`Context matched (regex fallback) ${siteDomain}, ID: ${siteId}`)
            const pagePath = pageUrl.split('/').slice(3).join('/') // Basic path extraction
            const contentUrl = `https://getclicky.com/stats/visitors?site_id=${siteId}&href=/${encodeURIComponent(
              pagePath
            )}`
            await chrome.tabs.create({ url: contentUrl, selected: true })
            return
          }
        }
      }
      console.log('Context menu clicked, but no matching site domain found for URL:', pageUrl)
    } catch (error) {
      console.error('Error handling context menu click:', error)
    }
  }
})

console.log('Clicky Monitor Service Worker Loaded.')
