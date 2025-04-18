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

// Import utility scripts
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
const GOAL_LOG_CLEAN_INTERVAL_MINUTES = 15
const GOAL_LOG_EXPIRY_SECONDS = 900 // 15 minutes
const IDLE_DETECTION_INTERVAL_SECONDS = 15 // Required minimum for chrome.idle

// Map original timings to minutes for alarms (minimum 1 minute period)
// Using 'live' values, converted to minutes
const SPY_INTERVALS_MINUTES = {
  t1: 1, // 60000ms
  t2: 2, // 120000ms
  t3: 5, // 300000ms
  t4: 10, // 600000ms
}

// Thresholds for increasing interval (based on machine idle time)
// Using 'live' checkTimes, converted to seconds
const CHECK_THRESHOLDS_SECONDS = {
  t1: 600, // 600000ms - after 10 mins idle, move to t2 interval
  t2: 1800, // 1800000ms - after 30 mins idle, move to t3 interval
  t3: 3600, // 3600000ms - after 60 mins idle, move to t4 interval
  t4: 7200, // 7200000ms - after 120 mins idle, stay at t4 interval (original stopped)
}

const DEFAULT_INTERVAL_LEVEL = 't1'

// --- State Keys for chrome.storage.local ---
const STORAGE_KEYS = [
  'clickychrome_badgeColor',
  'clickychrome_currentChart',
  'clickychrome_customName',
  'clickychrome_spyType',
  'clickychrome_goalNotification',
  'clickychrome_goalTimeout',
  'clickychrome_goalLog',
  'clickychrome_startTime',
  'clickychrome_currentSite',
  'clickychrome_names',
  'clickychrome_urls',
  'clickychrome_ids',
  'clickychrome_keys',
  // New state for idle backoff
  'lastActiveTimestamp',
  'currentIntervalLevel',
]

// --- Initialization and Event Listeners ---

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Clicky Monitor: onInstalled event.')
  await initializeDefaultsAndState()
  await setupContextMenu()
  await updateApiAlarm() // Setup initial alarm based on stored/default state
  await setupCleanGoalAlarm()
  await checkSpy() // Initial check on install/update
})

chrome.runtime.onStartup.addListener(async () => {
  console.log('Clicky Monitor: onStartup event.')
  // Ensure alarms are set up based on potentially persisted state
  await updateApiAlarm()
  await setupCleanGoalAlarm()
  // Optional: Run an initial check on browser startup? Maybe not needed if alarm fires soon.
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('Clicky Monitor: Alarm fired:', alarm.name)
  if (alarm.name === ALARM_CHECK_API) {
    // Before checking API, update alarm period based on current idle state
    await updateApiAlarm()
    await checkSpy()
  } else if (alarm.name === ALARM_CLEAN_GOALS) {
    cleanGoalLog()
  }
})

// Listen for changes in storage (e.g., options saved)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (ClickyChrome.Background.debug) console.log('Clicky Monitor: Storage changed:', changes)
    let needsApiCheck = false
    let needsContextMenuUpdate = false
    let needsBadgeUpdate = false

    // Check which settings changed
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
      needsBadgeUpdate = true
    }

    // Perform actions based on changes
    if (needsApiCheck) {
      console.log('Storage change triggers API check.')
      checkSpy() // Re-check API immediately
    }
    if (needsContextMenuUpdate) {
      console.log('Storage change triggers context menu update.')
      setupContextMenu() // Re-create/update context menu
    }
    if (needsBadgeUpdate) {
      updateBadgeColor()
    }
  }
})

// Listen for machine idle state changes
chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL_SECONDS)
chrome.idle.onStateChanged.addListener(async (newState) => {
  console.log(`Idle state changed to: ${newState}`)
  const now = Date.now() // Use ms timestamp

  if (newState === 'active') {
    // User became active
    await chrome.storage.local.set({ lastActiveTimestamp: now })
    // Reset alarm to fastest interval
    const data = await chrome.storage.local.get('currentIntervalLevel')
    const currentLevel = data.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL

    if (currentLevel !== 't1') {
      console.log('User active, resetting API check interval to fastest.')
      await chrome.storage.local.set({ currentIntervalLevel: 't1' })
      await updateApiAlarm() // Update alarm immediately
      // Trigger an immediate check since user is back
      await checkSpy()
    } else {
      if (ClickyChrome.Background.debug) console.log('User active, already at fastest interval.')
    }
    // Update badge text from 'IDLE' if it was set
    await checkSpy() // Re-run check to clear potential 'IDLE' badge
  } else if (newState === 'idle' || newState === 'locked') {
    // User became idle or locked. The interval update will happen
    // during the next alarm check based on lastActiveTimestamp.
    // We could optionally set an 'IDLE' badge here if desired.
    // await chrome.action.setBadgeText({ text: 'IDLE' });
  }
})

// Listen for messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let isAsync = false
  if (message.action === 'showOptions') {
    ClickyChrome.Background.showOptions()
    sendResponse({ status: 'Options tab opened/focused' })
  } else if (message.action === 'triggerApiCheck') {
    console.log('Received triggerApiCheck message')
    isAsync = true // Indicate async response
    // Simulate user becoming active to reset timer and trigger check
    ;(async () => {
      await chrome.storage.local.set({
        lastActiveTimestamp: Date.now(),
        currentIntervalLevel: 't1', // Reset level on manual trigger
      })
      await updateApiAlarm()
      await checkSpy()
      sendResponse({ status: 'API check triggered and interval reset' })
    })()
  } else if (message.action === 'createSampleNotification') {
    createSampleNotification()
    sendResponse({ status: 'Sample notification triggered' })
  } else if (message.action === 'getDebugState') {
    sendResponse({ debug: ClickyChrome.Background.debug })
  } else if (message.action === 'log') {
    console.log('LOG from', sender.url ? sender.url : 'popup/options', ':', message.data)
    sendResponse({ status: 'Logged' })
  } else {
    sendResponse({ status: 'Unknown action' })
  }
  // Return true to keep the message channel open for asynchronous responses
  return isAsync
})

// --- Core Functions ---

async function initializeDefaultsAndState() {
  console.log('Initializing default settings and state...')
  const defaults = {
    clickychrome_badgeColor: '0,0,0,200',
    clickychrome_currentChart: 'visitors',
    clickychrome_customName: 'yes',
    clickychrome_spyType: 'online',
    clickychrome_goalNotification: 'no',
    clickychrome_goalTimeout: '10',
    clickychrome_goalLog: {},
    clickychrome_startTime: Date.now(),
    // Idle state defaults
    lastActiveTimestamp: Date.now(),
    currentIntervalLevel: DEFAULT_INTERVAL_LEVEL,
    // Site config defaults (will be empty if never saved)
    clickychrome_names: '',
    clickychrome_urls: '',
    clickychrome_ids: '',
    clickychrome_keys: '',
    clickychrome_currentSite: '',
  }

  try {
    const currentSettings = await chrome.storage.local.get(STORAGE_KEYS)
    const settingsToSet = {}
    for (const key in defaults) {
      if (currentSettings[key] === undefined) {
        settingsToSet[key] = defaults[key]
        if (ClickyChrome.Background.debug) console.log(`Setting default for ${key}`)
      }
    }

    // Handle the old migration for URLs (keep this logic)
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

// Sets up the goal log cleaning alarm
async function setupCleanGoalAlarm() {
  try {
    await chrome.alarms.create(ALARM_CLEAN_GOALS, {
      delayInMinutes: 1, // Start cleaning after 1 minute
      periodInMinutes: GOAL_LOG_CLEAN_INTERVAL_MINUTES,
    })
    if (ClickyChrome.Background.debug)
      console.log(
        `Alarm '${ALARM_CLEAN_GOALS}' created/updated. Interval: ${GOAL_LOG_CLEAN_INTERVAL_MINUTES} minutes.`
      )
  } catch (error) {
    console.error('Error setting up clean goal alarm:', error)
  }
}

// Determines the correct API check interval based on idle time and updates the alarm
async function updateApiAlarm() {
  try {
    const data = await chrome.storage.local.get(['lastActiveTimestamp', 'currentIntervalLevel'])
    const lastActive = data.lastActiveTimestamp || Date.now()
    let currentLevel = data.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL
    const now = Date.now()
    const idleDurationSeconds = Math.floor((now - lastActive) / 1000)

    let newLevel = 't1'
    if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t4) {
      newLevel = 't4'
    } else if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t3) {
      newLevel = 't4' // Original t3 check moved to t4 spy time
    } else if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t2) {
      newLevel = 't3' // Original t2 check moved to t3 spy time
    } else if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t1) {
      newLevel = 't2' // Original t1 check moved to t2 spy time
    }

    const newPeriodMinutes = SPY_INTERVALS_MINUTES[newLevel]

    if (newLevel !== currentLevel) {
      console.log(
        `Idle duration ${idleDurationSeconds}s exceeds threshold. Changing interval level from ${currentLevel} to ${newLevel} (${newPeriodMinutes} min).`
      )
      currentLevel = newLevel
      await chrome.storage.local.set({ currentIntervalLevel: newLevel })
    } else {
      if (ClickyChrome.Background.debug)
        console.log(
          `Idle duration ${idleDurationSeconds}s. Keeping interval level ${currentLevel} (${newPeriodMinutes} min).`
        )
    }

    // Get current alarm info to see if period needs changing
    const currentAlarm = await chrome.alarms.get(ALARM_CHECK_API)

    // Update the Chrome alarm itself if the period differs or alarm doesn't exist
    if (!currentAlarm || currentAlarm.periodInMinutes !== newPeriodMinutes) {
      await chrome.alarms.create(ALARM_CHECK_API, {
        // delayInMinutes: 0.1, // Optional: fire quickly after change? Maybe not needed.
        periodInMinutes: newPeriodMinutes,
      })
      console.log(
        `API Check Alarm '${ALARM_CHECK_API}' ${
          currentAlarm ? 'updated' : 'created'
        }. New period: ${newPeriodMinutes} minutes.`
      )
    } else {
      if (ClickyChrome.Background.debug)
        console.log(`API Check Alarm period already set to ${newPeriodMinutes} minutes.`)
    }

    // Update badge text if idle for a long time (optional visual cue)
    if (newLevel === 't4' && idleDurationSeconds > CHECK_THRESHOLDS_SECONDS.t3) {
      // Example: Show IDLE if idle > 60 min
      await chrome.action.setBadgeText({ text: 'IDLE' })
    }
  } catch (error) {
    console.error('Error updating API alarm:', error)
    // Fallback: ensure a default alarm exists
    try {
      await chrome.alarms.create(ALARM_CHECK_API, {
        periodInMinutes: SPY_INTERVALS_MINUTES[DEFAULT_INTERVAL_LEVEL],
      })
    } catch (fallbackError) {
      console.error('Failed to create fallback alarm:', fallbackError)
    }
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
      await chrome.tabs.update(tabs[0].id, { active: true })
      await chrome.windows.update(tabs[0].windowId, { focused: true })
      console.log('Focused existing options tab:', tabs[0].id)
    } else {
      const newTab = await chrome.tabs.create({ url: optionsUrl, selected: true })
      console.log('Created new options tab:', newTab.id)
    }
  } catch (error) {
    console.error('Error showing options page:', error)
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
      'clickychrome_startTime',
      'currentIntervalLevel', // Needed to potentially clear 'IDLE' badge
    ])

    // Check if currently in the longest idle state to avoid overwriting 'IDLE' badge
    const isDeepIdle = settings.currentIntervalLevel === 't4'

    if (!settings.clickychrome_currentSite) {
      console.log('Spy: No current site selected. Setting title.')
      ClickyChrome.Functions.setTitle('ClickyChrome - No Site Selected')
      if (!isDeepIdle) ClickyChrome.Functions.setBadgeText('') // Clear badge if not deep idle
      return
    }

    const siteInfo = settings.clickychrome_currentSite.split(',') // [id, key, name]
    const spyType = settings.clickychrome_spyType || 'online'
    const goalNotificationsEnabled = settings.clickychrome_goalNotification === 'yes'
    const startTime = settings.clickychrome_startTime || Date.now()

    // Calculate goal time offset
    const now = Date.now()
    const elapsedSeconds = Math.floor((now - startTime) / 1000)
    let goalTimeOffset = 600
    if (elapsedSeconds < 600) {
      goalTimeOffset = Math.max(0, elapsedSeconds + 30) // Ensure non-negative
    }
    if (ClickyChrome.Background.debug) console.log('Goal time offset calculated:', goalTimeOffset)

    // Build API URL
    let apiUrl = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&date=today&output=json&app=clickychrome`
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
        types.push('visitors-online')
    }
    if (goalNotificationsEnabled) {
      if (!types.includes('goals')) types.push('goals')
      // Fetch visitors-list for goal notification details
      types.push('visitors-list')
      apiUrl += `&goal=*&time_offset=${goalTimeOffset}`
    }
    apiUrl += `&type=${types.join(',')}`

    // Update browser action title
    updateTitle(siteInfo, spyType)

    if (ClickyChrome.Background.debug) console.log('API URL:', apiUrl)

    // Perform Fetch
    const response = await fetch(apiUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = await response.json()

    if (ClickyChrome.Background.debug)
      console.log('API Response Data:', JSON.stringify(data).substring(0, 500) + '...') // Log snippet

    if (data && Array.isArray(data) && data.length > 0 && data[0]) {
      if (data[0].error) {
        console.error('Clicky API Error:', data[0].error)
        ClickyChrome.Functions.setTitle(`Error: ${data[0].error}`)
        if (!isDeepIdle) ClickyChrome.Functions.setBadgeText('ERR')
      } else {
        // Process Badge
        let badgeData = data.find((item) => item.type === spyType)
        let badgeValue = badgeData?.dates?.[0]?.items?.[0]?.value

        if (spyType === 'goals' && badgeValue === undefined) {
          // If goal spy type selected but no goals data found (maybe 0 goals), treat as 0
          let goalItem = data.find((item) => item.type === 'goals')
          if (goalItem?.dates?.[0]?.items?.length === 0 || !goalItem?.dates?.[0]?.items) {
            badgeValue = 0
            if (ClickyChrome.Background.debug)
              console.log('Setting badge to 0 for goals type as no goal items found.')
          }
        }

        if (badgeValue !== undefined) {
          if (!isDeepIdle) {
            // Only update badge if not in deep idle (to preserve 'IDLE' text)
            ClickyChrome.Functions.setBadgeNum(badgeValue)
            if (ClickyChrome.Background.debug)
              console.log(`Badge updated for ${spyType}:`, badgeValue)
          } else {
            if (ClickyChrome.Background.debug)
              console.log(
                `Deep idle state, preserving 'IDLE' badge instead of setting ${badgeValue}`
              )
          }
        } else {
          console.warn(`Could not find value for badge type '${spyType}' in API response.`)
          if (!isDeepIdle) ClickyChrome.Functions.setBadgeText('?')
        }

        // Process Notifications
        if (goalNotificationsEnabled) {
          // Find visitors-list data specifically for notifications
          let goalVisitorData = data.find((item) => item.type === 'visitors-list')
          let goalItems = goalVisitorData?.dates?.[0]?.items
          if (goalItems && goalItems.length > 0) {
            if (ClickyChrome.Background.debug)
              console.log('Goal visitor data found for potential notification:', goalItems.length)
            await processAndCreateNotifications(goalItems)
          } else {
            if (ClickyChrome.Background.debug)
              console.log('Goal notifications enabled, but no goal visitor list data found.')
          }
        }
      }
    } else {
      console.warn('Received empty or invalid data from Clicky API.')
      if (!isDeepIdle) ClickyChrome.Functions.setBadgeText('?')
    }
  } catch (error) {
    console.error('Error in checkSpy:', error)
    ClickyChrome.Functions.setTitle('Clicky Monitor - API Error')
    // Only set ERR badge if not in deep idle state
    const data = await chrome.storage.local.get('currentIntervalLevel')
    if (data.currentIntervalLevel !== 't4') {
      ClickyChrome.Functions.setBadgeText('ERR')
    }
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
  const siteName = siteInfo?.[2] || 'Unknown Site'
  const titlePrefix = titleInfo[spyType]?.titleString || 'Stats: '
  ClickyChrome.Functions.setTitle(titlePrefix + siteName)
}

/**
 * Processes goal data and creates notifications if new goals are found.
 */
async function processAndCreateNotifications(apiGoalItems) {
  if (ClickyChrome.Background.debug) console.log('Processing goal data for notifications...')

  try {
    const { clickychrome_goalLog: currentLog = {} } = await chrome.storage.local.get([
      'clickychrome_goalLog',
    ])

    // Ensure Process.goals exists
    if (typeof ClickyChrome?.Process?.goals !== 'function') {
      throw new Error('ClickyChrome.Process.goals function is not available.')
    }

    const processedData = ClickyChrome.Process.goals(apiGoalItems, currentLog) // Pass current log

    if (processedData.newGoals && Object.keys(processedData.newGoals).length > 0) {
      const newGoals = processedData.newGoals
      const updatedLog = processedData.updatedLog

      if (ClickyChrome.Background.debug) {
        console.log('New goals found for notification:', newGoals)
      }

      // Store the updated log immediately
      await chrome.storage.local.set({ clickychrome_goalLog: updatedLog })

      // --- Create Simplified Notification ---
      const goalKeys = Object.keys(newGoals)
      const firstGoal = newGoals[goalKeys[0]]
      let notificationTitle = 'Goal Completed!'
      let notificationMessage = `${firstGoal.goals} by ${firstGoal.visitor}`
      let notificationItems = []

      if (goalKeys.length > 1) {
        notificationTitle = `${goalKeys.length} Goals Completed!`
        notificationItems = goalKeys
          .map((key) => {
            const goal = newGoals[key]
            return { title: goal.goals, message: `by ${goal.visitor} (${goal.geo})` }
          })
          .slice(0, 5)
        notificationMessage = `${notificationItems.length} new goals. See list.`
      }

      const iconUrl = chrome.runtime.getURL('images/clicky_icon_48.png')
      const notificationId = `clickyGoal_${Date.now()}`

      const notificationOptions = {
        type: goalKeys.length > 1 && notificationItems.length > 0 ? 'list' : 'basic',
        iconUrl: iconUrl,
        title: notificationTitle,
        message: notificationMessage,
        priority: 1,
        requireInteraction: false, // Auto-close (Chrome handles timing)
      }

      if (notificationOptions.type === 'list') {
        notificationOptions.items = notificationItems
      }

      chrome.notifications.create(notificationId, notificationOptions, (createdId) => {
        if (chrome.runtime.lastError) {
          console.error('Error creating notification:', chrome.runtime.lastError.message)
        } else {
          if (ClickyChrome.Background.debug) console.log('Notification created:', createdId)
          // Store associated URL for click handling
          chrome.storage.local.set({ [`notification_url_${createdId}`]: firstGoal.url })
        }
      })
    } else {
      if (ClickyChrome.Background.debug) console.log('No new, unique goals found to notify.')
      // Save updated log even if no new notifications (e.g., goal name changed on existing session)
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
  if (ClickyChrome.Background.debug) console.log(`Notification clicked: ${notificationId}`)
  if (notificationId.startsWith('clickyGoal_')) {
    const storageKey = `notification_url_${notificationId}`
    try {
      const data = await chrome.storage.local.get(storageKey)
      if (data[storageKey]) {
        chrome.tabs.create({ url: data[storageKey], selected: true })
        await chrome.storage.local.remove(storageKey)
      } else {
        console.warn('No URL found for clicked notification:', notificationId)
      }
      chrome.notifications.clear(notificationId)
    } catch (error) {
      console.error('Error handling notification click:', error)
    }
  } else if (notificationId === 'clickySample') {
    console.log('Sample notification clicked.')
    chrome.notifications.clear(notificationId)
  }
})

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
      console.error('Error creating sample notification:', chrome.runtime.lastError.message)
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
    const nowSeconds = Math.floor(Date.now() / 1000)
    let changed = false
    let deletedCount = 0

    for (const id in goalLog) {
      if (goalLog.hasOwnProperty(id)) {
        const timestamp = Number(goalLog[id]?.timestamp)
        if (!isNaN(timestamp) && nowSeconds - timestamp > GOAL_LOG_EXPIRY_SECONDS) {
          delete goalLog[id]
          changed = true
          deletedCount++
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
let currentContextMenuId = null // Keep track of menu ID

async function setupContextMenu() {
  console.log('Setting up context menu...')
  try {
    // Use a static ID for easier updates/removal
    const CONTEXT_MENU_ID = 'clickyViewPageStats'

    // Attempt to remove previous menu item cleanly
    try {
      await chrome.contextMenus.remove(CONTEXT_MENU_ID)
      if (ClickyChrome.Background.debug)
        console.log('Removed existing context menu:', CONTEXT_MENU_ID)
    } catch (removeError) {
      if (ClickyChrome.Background.debug && !removeError.message.includes('No item with id')) {
        console.log('Context menu removal error (may be harmless):', removeError.message)
      }
    }

    const data = await chrome.storage.local.get(['clickychrome_urls', 'clickychrome_ids'])
    const urlsString = data.clickychrome_urls
    const idsString = data.clickychrome_ids

    if (!urlsString || !idsString || urlsString.trim() === '' || idsString.trim() === '') {
      if (ClickyChrome.Background.debug)
        console.log('Context menu not created: Missing URLs or IDs.')
      return
    }

    const urls = urlsString.split(',')
    const patterns = []
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim()
      if (url !== '') {
        const clean = url.replace(/^((?:[a-z][a-z0-9+\-.]*:)?\/\/)?(www\.)?/gi, '').split('/')[0] // Get hostname only
        if (clean) {
          // Ensure we have a hostname after cleaning
          patterns.push(`*://${clean}/*`)
          patterns.push(`*://www.${clean}/*`)
        }
      }
    }

    if (patterns.length > 0) {
      // Remove potential duplicates
      const uniquePatterns = [...new Set(patterns)]

      await chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'View page stats on Clicky',
        contexts: ['page', 'link'],
        documentUrlPatterns: uniquePatterns,
        targetUrlPatterns: uniquePatterns, // Apply to link targets too
      })
      if (ClickyChrome.Background.debug)
        console.log(
          `Context menu created/updated. ID: ${CONTEXT_MENU_ID}, Patterns: ${uniquePatterns.join(
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

// Context menu click handler (remains the same)
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'clickyViewPageStats') {
    if (ClickyChrome.Background.debug) console.log('Context menu clicked:', info)
    const pageUrl = info.linkUrl || info.pageUrl // Prioritize linkUrl if present
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

        try {
          const pageHostname = new URL(pageUrl).hostname.replace(/^www\./i, '')
          const configuredHostname = siteDomain.replace(/^www\./i, '').split('/')[0] // Hostname only

          if (pageHostname === configuredHostname) {
            const siteId = idArray[i]
            if (ClickyChrome.Background.debug)
              console.log(`Context matched ${configuredHostname}, ID: ${siteId}`)

            const pagePath =
              new URL(pageUrl).pathname + new URL(pageUrl).search + new URL(pageUrl).hash
            const contentUrl = `https://getclicky.com/stats/visitors?site_id=${siteId}&href=${encodeURIComponent(
              pagePath
            )}`

            await chrome.tabs.create({ url: contentUrl, selected: true })
            return // Stop after first match
          }
        } catch (urlError) {
          console.warn('Could not parse URL for context matching:', pageUrl, urlError)
          // Add regex fallback if needed, but hostname matching is preferred
        }
      }
      if (ClickyChrome.Background.debug)
        console.log('Context menu clicked, but no matching site domain found for URL:', pageUrl)
    } catch (error) {
      console.error('Error handling context menu click:', error)
    }
  }
})

console.log('Clicky Monitor Service Worker Loaded.')
