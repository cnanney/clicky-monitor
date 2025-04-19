/**
 * Clicky Monitor - Manifest V3
 * --------------
 * Service Worker based background script with Idle Backoff using chrome.idle and chrome.tabs.
 */

// Define the global namespace *before* importing scripts that rely on it.
self.ClickyChrome = self.ClickyChrome || {} // Ensure ClickyChrome exists globally

// Import utility scripts using importScripts
try {
  // Ensure paths are correct relative to the extension's root directory
  importScripts('functions.js', 'process.js')
} catch (e) {
  console.error('Error importing utility scripts:', e)
  // If imports fail, essential functions might be missing.
}

// Now ClickyChrome.Functions and ClickyChrome.Process should be populated
ClickyChrome.Background = {} // Define the Background part of the namespace

// --- Constants ---
const ALARM_CHECK_API = 'checkApi'
const ALARM_CLEAN_GOALS = 'cleanGoalLog'
const GOAL_LOG_CLEAN_INTERVAL_MINUTES = 15
const GOAL_LOG_EXPIRY_SECONDS = 900
const IDLE_DETECTION_INTERVAL_SECONDS = 15 // Required minimum for chrome.idle
const API_APP_PARAM = 'clickychrome' // Constant for API calls

// Map original timings to minutes for alarms (minimum 1 minute period)
const SPY_INTERVALS_MINUTES = {
  t1: 1, // 60000ms
  t2: 2, // 120000ms
  t3: 5, // 300000ms
  t4: 10, // 600000ms
}

// Thresholds for increasing interval (based on machine idle time)
const CHECK_THRESHOLDS_SECONDS = {
  t1: 600, // 10 mins idle -> t2 interval
  t2: 1800, // 30 mins idle -> t3 interval
  t3: 3600, // 60 mins idle -> t4 interval
  t4: 7200, // 120 mins idle -> stay at t4 (threshold not strictly needed)
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
  'lastActiveTimestamp',
  'currentIntervalLevel',
]

// --- Helper Function to Update Timestamp (Debounced) ---
let timestampUpdateTimeout = null
const DEBOUNCE_DELAY_MS = 500 // 500ms debounce

async function updateLastActiveTimestamp() {
  clearTimeout(timestampUpdateTimeout) // Clear existing timeout
  timestampUpdateTimeout = setTimeout(async () => {
    try {
      await chrome.storage.local.set({ lastActiveTimestamp: Date.now() })
      console.log('Updated lastActiveTimestamp due to tab/browser activity.')
    } catch (error) {
      console.error('Error setting lastActiveTimestamp:', error)
    }
  }, DEBOUNCE_DELAY_MS)
}

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
  // Update timestamp on startup as well, assuming user is active
  await chrome.storage.local.set({ lastActiveTimestamp: Date.now() })
  console.log('Updated lastActiveTimestamp on browser startup.')
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('Clicky Monitor: Alarm fired:', alarm.name)
  if (alarm.name === ALARM_CHECK_API) {
    await updateApiAlarm() // Update period based on last known activity first
    await checkSpy() // Then perform the API check
  } else if (alarm.name === ALARM_CLEAN_GOALS) {
    cleanGoalLog()
  }
})

// Listen for storage changes (options saved)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    console.log('Clicky Monitor: Storage changed:', changes)
    let needsApiCheck = false
    let needsContextMenuUpdate = false
    let needsBadgeUpdate = false
    // Determine actions based on changed keys
    if (
      changes.clickychrome_currentSite ||
      changes.clickychrome_spyType ||
      changes.clickychrome_goalNotification
    )
      needsApiCheck = true
    if (changes.clickychrome_urls || changes.clickychrome_ids) needsContextMenuUpdate = true
    if (changes.clickychrome_badgeColor) needsBadgeUpdate = true
    // Execute actions
    if (needsApiCheck) {
      console.log('Storage change triggers API check.')
      checkSpy()
    }
    if (needsContextMenuUpdate) {
      console.log('Storage change triggers context menu update.')
      setupContextMenu()
    }
    if (needsBadgeUpdate) updateBadgeColor()
  }
})

// Listen for machine idle state changes
chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL_SECONDS)
chrome.idle.onStateChanged.addListener(async (newState) => {
  console.log(`Machine Idle state changed to: ${newState}`)
  if (newState === 'active') {
    console.log('Machine state now active, updating timestamp and resetting interval.')
    // Update timestamp and reset level/alarm when coming back from MACHINE idle
    await chrome.storage.local.set({
      lastActiveTimestamp: Date.now(),
      currentIntervalLevel: 't1',
    })
    await updateApiAlarm() // Update alarm immediately to fastest rate
    await checkSpy() // Trigger immediate check
  } else {
    console.log('Machine state now idle or locked.')
    // No timestamp update needed here. updateApiAlarm will handle interval change.
  }
})

// --- Listen for Tab Activity to update timestamp ---
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // User switched to a tab
  console.log('Tab activated:', activeInfo.tabId)
  await updateLastActiveTimestamp() // Record activity (debounced)
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Tab updated (e.g., loaded, navigated)
  // Only update timestamp if status changes to 'complete' for non-chrome URLs,
  // or if audio state changes (playing/muting).
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    console.log('Tab updated and loaded:', tabId, tab.url)
    await updateLastActiveTimestamp() // Record activity (debounced)
  } else if (changeInfo.audible !== undefined) {
    console.log('Tab audio state changed:', tabId)
    await updateLastActiveTimestamp() // Record activity (debounced)
  }
})

// Listen for window focus changes as another indicator of activity
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  // WINDOW_ID_NONE means focus lost from Chrome entirely
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    console.log('Chrome window focused:', windowId)
    await updateLastActiveTimestamp() // Record activity (debounced)
  } else {
    console.log('Chrome window lost focus.')
    // No timestamp update when focus is lost
  }
})

// Listen for messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let isAsync = false
  switch (message.action) {
    case 'showOptions':
      ClickyChrome.Background.showOptions() // Should be synchronous
      sendResponse({ status: 'Options tab opened/focused' })
      break
    case 'triggerApiCheck':
      console.log('Received triggerApiCheck message (manual trigger)')
      isAsync = true
      ;(async () => {
        // Explicitly update timestamp on manual trigger, reset level
        await chrome.storage.local.set({
          lastActiveTimestamp: Date.now(),
          currentIntervalLevel: 't1',
        })
        await updateApiAlarm()
        await checkSpy()
        sendResponse({ status: 'API check triggered and interval reset' })
      })()
      break
    case 'createSampleNotification':
      createSampleNotification()
      sendResponse({ status: 'Sample notification triggered' })
      break
    case 'log':
      console.log('LOG from', sender.url ? sender.url : 'popup/options', ':', message.data)
      sendResponse({ status: 'Logged' })
      break
    default:
      sendResponse({ status: 'Unknown action' })
  }
  // Return true IF response is async
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
    lastActiveTimestamp: Date.now(), // Initialize with current time
    currentIntervalLevel: DEFAULT_INTERVAL_LEVEL,
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
        console.log(`Setting default for ${key}`)
      }
    }
    // URL migration logic
    if (
      currentSettings.clickychrome_urls === undefined &&
      currentSettings.clickychrome_ids !== undefined
    ) {
      const names = (currentSettings.clickychrome_names || '').split(',')
      const blankUrls = Array(names.length).fill('')
      settingsToSet['clickychrome_urls'] = blankUrls.join(',')
      console.log('Migrating old settings: creating blank URLs array.')
    }
    // Set defaults if any are missing
    if (Object.keys(settingsToSet).length > 0) {
      await chrome.storage.local.set(settingsToSet)
      console.log('Defaults set:', settingsToSet)
    }
    await updateBadgeColor() // Set initial color
  } catch (error) {
    console.error('Error initializing defaults:', error)
  }
}

async function setupCleanGoalAlarm() {
  try {
    await chrome.alarms.create(ALARM_CLEAN_GOALS, {
      delayInMinutes: 1, // Start cleaning after 1 minute
      periodInMinutes: GOAL_LOG_CLEAN_INTERVAL_MINUTES,
    })
    console.log(
      `Alarm '${ALARM_CLEAN_GOALS}' created/updated. Interval: ${GOAL_LOG_CLEAN_INTERVAL_MINUTES} minutes.`
    )
  } catch (error) {
    console.error('Error setting up clean goal alarm:', error)
  }
}

// updateApiAlarm: Calculates interval based on stored lastActiveTimestamp
async function updateApiAlarm() {
  try {
    const data = await chrome.storage.local.get(['lastActiveTimestamp', 'currentIntervalLevel'])
    // Use current time as fallback for lastActive to prevent huge durations if storage read fails
    const lastActive = data.lastActiveTimestamp || Date.now()
    let currentLevel = data.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL
    const now = Date.now()
    // Ensure idle duration isn't negative if clocks change or timestamp is future
    const idleDurationSeconds = Math.max(0, Math.floor((now - lastActive) / 1000))

    let newLevel = 't1'
    // Determine new level based on thresholds
    if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t3) newLevel = 't4'
    else if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t2) newLevel = 't3'
    else if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t1) newLevel = 't2'

    const newPeriodMinutes = SPY_INTERVALS_MINUTES[newLevel]

    // Update level in storage only if it changed
    if (newLevel !== currentLevel) {
      console.log(
        `Idle duration ${idleDurationSeconds}s. Changing interval level from ${currentLevel} to ${newLevel} (${newPeriodMinutes} min).`
      )
      currentLevel = newLevel // Use newLevel for comparison below
      await chrome.storage.local.set({ currentIntervalLevel: newLevel })
    } else {
      console.log(
        `Idle duration ${idleDurationSeconds}s. Keeping interval level ${currentLevel} (${newPeriodMinutes} min).`
      )
    }

    // Update the Chrome alarm itself if the period differs or alarm doesn't exist
    const currentAlarm = await chrome.alarms.get(ALARM_CHECK_API)
    if (!currentAlarm || currentAlarm.periodInMinutes !== newPeriodMinutes) {
      await chrome.alarms.create(ALARM_CHECK_API, {
        periodInMinutes: newPeriodMinutes,
      })
      console.log(
        `API Check Alarm '${ALARM_CHECK_API}' ${
          currentAlarm ? 'updated' : 'created'
        }. New period: ${newPeriodMinutes} minutes.`
      )
    } else {
      console.log(`API Check Alarm period already set to ${newPeriodMinutes} minutes.`)
    }

    // Set IDLE badge only if actually in the longest interval state
    if (newLevel === 't4') {
      await chrome.action.setBadgeText({ text: 'IDLE' })
      console.log('Setting IDLE badge.')
    }
    // NOTE: Clearing the 'IDLE' badge when *not* t4 happens inside checkSpy
    // after a successful fetch, to ensure the badge reflects current data.
  } catch (error) {
    console.error('Error updating API alarm:', error)
    // Fallback: ensure a default alarm exists
    try {
      await chrome.alarms.create(ALARM_CHECK_API, {
        periodInMinutes: SPY_INTERVALS_MINUTES[DEFAULT_INTERVAL_LEVEL],
      })
      console.warn('Created fallback default API alarm due to error.')
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
    // Basic validation for the color array
    if (colors.length === 4 && colors.every((c) => !isNaN(c) && c >= 0 && c <= 255)) {
      await chrome.action.setBadgeBackgroundColor({
        color: [colors[0], colors[1], colors[2], colors[3]],
      })
      console.log('Badge color updated:', colors)
    } else {
      console.error('Invalid badge color format or values in storage:', colorString)
      // Optionally set a default color on error
      await chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 200] })
    }
  } catch (error) {
    console.error('Error setting badge color:', error)
  }
}

ClickyChrome.Background.showOptions = async () => {
  const optionsUrl = chrome.runtime.getURL('options.html')
  try {
    const tabs = await chrome.tabs.query({ url: optionsUrl })
    if (tabs.length > 0) {
      // If options page is open, focus it
      await chrome.tabs.update(tabs[0].id, { active: true })
      await chrome.windows.update(tabs[0].windowId, { focused: true })
      console.log('Focused existing options tab:', tabs[0].id)
    } else {
      // Otherwise, create a new tab
      const newTab = await chrome.tabs.create({ url: optionsUrl, selected: true })
      console.log('Created new options tab:', newTab.id)
    }
  } catch (error) {
    console.error('Error showing options page:', error)
    // Fallback if query fails? Less likely needed now.
    try {
      await chrome.tabs.create({ url: optionsUrl, selected: true })
    } catch (createError) {
      console.error('Error creating options tab as fallback:', createError)
    }
  }
}

// checkSpy: Performs the API check. Reads state, fetches, processes, updates badge/notifications.
// Does NOT update lastActiveTimestamp itself.
async function checkSpy() {
  // Check if utility functions loaded
  if (
    typeof ClickyChrome?.Functions?.setTitle !== 'function' ||
    typeof ClickyChrome?.Process?.goals !== 'function'
  ) {
    console.error('Utility functions not loaded correctly. API check aborted.')
    try {
      await chrome.action.setBadgeText({ text: 'ERR' })
    } catch (e) {
      console.error('Failed to set error badge:', e)
    }
    return
  }
  console.log('Spy: Fetching API data...')

  try {
    // Get current settings and state
    const settings = await chrome.storage.local.get([
      'clickychrome_currentSite',
      'clickychrome_spyType',
      'clickychrome_goalNotification',
      'clickychrome_startTime',
      'currentIntervalLevel', // Needed for badge logic
    ])
    const currentLevel = settings.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL // Get current level

    // Exit if no site configured
    if (!settings.clickychrome_currentSite) {
      console.log('Spy: No current site selected.')
      ClickyChrome.Functions.setTitle('ClickyChrome - No Site Selected')
      // Clear badge only if not in the deep idle state ('t4')
      if (currentLevel !== 't4') ClickyChrome.Functions.setBadgeText('')
      return // Exit early
    }

    // Prepare API call parameters
    const siteInfo = settings.clickychrome_currentSite.split(',')
    const spyType = settings.clickychrome_spyType || 'online'
    const goalNotificationsEnabled = settings.clickychrome_goalNotification === 'yes'
    const startTime = settings.clickychrome_startTime || Date.now()
    const now = Date.now() // Timestamp for this check cycle
    const elapsedSeconds = Math.floor((now - startTime) / 1000)
    let goalTimeOffset = 600 // Max offset 10 minutes
    if (elapsedSeconds < 600) goalTimeOffset = Math.max(0, elapsedSeconds + 30) // Prevent negative offset
    console.log('Goal time offset:', goalTimeOffset)

    // Map internal spyType to API type key
    let apiBadgeType
    switch (spyType) {
      case 'online':
        apiBadgeType = 'visitors-online'
        break
      case 'visitors':
        apiBadgeType = 'visitors'
        break
      case 'goals':
        apiBadgeType = 'goals'
        break
      default:
        apiBadgeType = 'visitors-online'
        console.warn(`Unexpected spyType "${spyType}"`)
    }
    console.log(`Internal spyType: ${spyType}, Mapped API badge type: ${apiBadgeType}`)

    // Construct API URL
    let apiUrl = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&date=today&output=json&app=${API_APP_PARAM}`
    let types = [apiBadgeType] // Start with the type needed for the badge
    if (goalNotificationsEnabled) {
      if (!types.includes('goals')) types.push('goals')
      if (!types.includes('visitors-list')) types.push('visitors-list') // Needed for goal details
      apiUrl += `&goal=*&time_offset=${goalTimeOffset}`
    }
    types = [...new Set(types)] // Ensure no duplicates
    apiUrl += `&type=${types.join(',')}`

    updateTitle(siteInfo, spyType) // Update tooltip title based on internal type
    console.log('API URL:', apiUrl)

    // Fetch data
    const response = await fetch(apiUrl, { cache: 'no-store' })
    if (!response.ok)
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`)
    const data = await response.json()
    console.log('API Response (Snippet):', JSON.stringify(data).substring(0, 500) + '...')

    // Process Response
    if (data && Array.isArray(data) && data.length > 0) {
      let apiError = null
      // Find first error object in response array
      for (const item of data) {
        if (item && item.error) {
          apiError = item.error
          break
        }
      }

      if (apiError) {
        console.error('Clicky API Error:', apiError)
        ClickyChrome.Functions.setTitle(`Error: ${apiError}`)
        // Set ERR badge only if not in deep idle
        if (currentLevel !== 't4') ClickyChrome.Functions.setBadgeText('ERR')
      } else {
        // Process Badge
        let badgeData = data.find((item) => item.type === apiBadgeType)
        let badgeValue = badgeData?.dates?.[0]?.items?.[0]?.value
        // Special handling for goals type badge value
        if (spyType === 'goals' && badgeValue === undefined) {
          let goalItem = data.find((item) => item.type === 'goals')
          // If the 'goals' type exists but has no items or isn't found, value is 0
          if (!goalItem?.dates?.[0]?.items || goalItem.dates[0].items.length === 0) {
            badgeValue = 0
            console.log('Setting badge value to 0 for goals type.')
          }
        }

        if (badgeValue !== undefined) {
          // Check level *again* right before setting badge, as state might change
          const levelData = await chrome.storage.local.get('currentIntervalLevel')
          const currentCheckLevel = levelData.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL

          if (currentCheckLevel !== 't4') {
            ClickyChrome.Functions.setBadgeNum(badgeValue) // Update badge with number
            console.log(`Badge updated for ${spyType} (${apiBadgeType}):`, badgeValue)
          } else {
            console.log(
              `Deep idle state (t4), preserving 'IDLE' badge instead of setting ${badgeValue}`
            )
            await chrome.action.setBadgeText({ text: 'IDLE' }) // Ensure it's IDLE
          }
        } else {
          console.warn(
            `Could not find value for badge type '${apiBadgeType}' (mapped from '${spyType}') in API response.`
          )
          // Set '?' badge only if not in deep idle
          const levelData = await chrome.storage.local.get('currentIntervalLevel')
          if ((levelData.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL) !== 't4') {
            ClickyChrome.Functions.setBadgeText('?')
          }
        }
        // Process Notifications
        if (goalNotificationsEnabled) {
          let goalVisitorData = data.find((item) => item.type === 'visitors-list')
          let goalItems = goalVisitorData?.dates?.[0]?.items
          if (goalItems && goalItems.length > 0) {
            console.log('Goal visitor data found for potential notification:', goalItems.length)
            await processAndCreateNotifications(goalItems)
          } else {
            console.log('Goal notifications enabled, but no goal visitor list data found.')
          }
        }
        // --- Successful processing complete ---
      }
    } else {
      console.warn('Received empty or invalid data from Clicky API.')
      // Set '?' badge only if not in deep idle
      if (currentLevel !== 't4') ClickyChrome.Functions.setBadgeText('?')
    }
  } catch (error) {
    console.error('Error in checkSpy:', error)
    ClickyChrome.Functions.setTitle('Clicky Monitor - API Error')
    // Set ERR badge only if not in deep idle state
    const stateData = await chrome.storage.local.get('currentIntervalLevel')
    if ((stateData.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL) !== 't4') {
      ClickyChrome.Functions.setBadgeText('ERR')
    }
  }
}

async function updateTitle(siteInfo, spyType) {
  const titleInfo = {
    online: { titleString: 'Visitors Online: ' },
    goals: { titleString: 'Goals Completed: ' },
    visitors: { titleString: 'Visitors Today: ' },
  }
  const siteName = siteInfo?.[2] || 'Unknown Site' // Handle potential undefined siteInfo[2]
  const titlePrefix = titleInfo[spyType]?.titleString || 'Stats: '
  ClickyChrome.Functions.setTitle(titlePrefix + siteName)
}

async function processAndCreateNotifications(apiGoalItems) {
  console.log('Processing goal data for notifications...')
  try {
    const { clickychrome_goalLog: currentLog = {} } = await chrome.storage.local.get([
      'clickychrome_goalLog',
    ])

    if (typeof ClickyChrome?.Process?.goals !== 'function') {
      throw new Error('ClickyChrome.Process.goals function is not available.')
    }

    const processedData = ClickyChrome.Process.goals(apiGoalItems, currentLog) // Pass current log

    if (processedData.newGoals && Object.keys(processedData.newGoals).length > 0) {
      const newGoals = processedData.newGoals
      const updatedLog = processedData.updatedLog
      console.log('New goals found for notification:', newGoals)

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
        type: goalKeys.length > 1 && notificationItems.length > 0 ? 'list' : 'basic',
        iconUrl: iconUrl,
        title: notificationTitle,
        message: notificationMessage,
        priority: 1, // 0 to 2
        requireInteraction: false, // Auto-close (Chrome handles timing)
      }

      if (notificationOptions.type === 'list') {
        notificationOptions.items = notificationItems
      }

      // Create notification and handle potential errors
      chrome.notifications.create(notificationId, notificationOptions, (createdId) => {
        if (chrome.runtime.lastError) {
          console.error('Error creating notification:', chrome.runtime.lastError.message)
        } else {
          console.log('Notification created:', createdId)
          // Store associated URL for click handling
          chrome.storage.local.set({ [`notification_url_${createdId}`]: firstGoal.url })
        }
      })
    } else {
      console.log('No new, unique goals found to notify.')
      // Save updated log even if no new notifications (e.g., goal name changed on existing session)
      if (
        processedData.updatedLog &&
        JSON.stringify(processedData.updatedLog) !== JSON.stringify(currentLog)
      ) {
        await chrome.storage.local.set({ clickychrome_goalLog: processedData.updatedLog })
        console.log('Goal log updated even without new notifications.')
      }
    }
  } catch (error) {
    console.error('Error processing or creating notifications:', error)
  }
}

// Notification click listener
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
      console.log('Sample notification created:', id)
    }
  })
}

async function cleanGoalLog() {
  console.log('Cleaning goal log...')
  try {
    const data = await chrome.storage.local.get('clickychrome_goalLog')
    const goalLog = data.clickychrome_goalLog || {}
    const nowSeconds = Math.floor(Date.now() / 1000)
    let changed = false
    let deletedCount = 0

    for (const id in goalLog) {
      if (goalLog.hasOwnProperty(id)) {
        const timestamp = Number(goalLog[id]?.timestamp)
        // Check if timestamp is valid and expired
        if (!isNaN(timestamp) && nowSeconds - timestamp > GOAL_LOG_EXPIRY_SECONDS) {
          delete goalLog[id]
          changed = true
          deletedCount++
        } else if (isNaN(timestamp)) {
          // Remove entries with invalid timestamps
          console.warn(`Goal log entry #${id} has invalid timestamp, removing.`)
          delete goalLog[id]
          changed = true
          deletedCount++
        }
      }
    }
    // Save back to storage only if changes were made
    if (changed) {
      await chrome.storage.local.set({ clickychrome_goalLog: goalLog })
      console.log(`Goal log cleaned. ${deletedCount} entries removed.`)
    } else {
      console.log('Goal log clean. No expired entries found.')
    }
  } catch (error) {
    console.error('Error cleaning goal log:', error)
  }
}

// --- Context Menu ---
async function setupContextMenu() {
  console.log('Setting up context menu...')
  try {
    const CONTEXT_MENU_ID = 'clickyViewPageStats' // Static ID is better

    // Attempt to remove previous menu item cleanly first
    try {
      await chrome.contextMenus.remove(CONTEXT_MENU_ID)
      console.log('Removed existing context menu:', CONTEXT_MENU_ID)
    } catch (removeError) {
      // Ignore error if menu ID doesn't exist (e.g., after browser restart or first install)
      if (!removeError.message.includes('No item with id')) {
        console.log('Context menu removal error (may be harmless):', removeError.message)
      }
    }

    // Get site URLs and IDs from storage
    const data = await chrome.storage.local.get(['clickychrome_urls', 'clickychrome_ids'])
    const urlsString = data.clickychrome_urls
    const idsString = data.clickychrome_ids

    // Don't create menu if no sites configured
    if (!urlsString || !idsString || urlsString.trim() === '' || idsString.trim() === '') {
      console.log('Context menu not created: Missing URLs or IDs in storage.')
      return
    }

    const urls = urlsString.split(',')
    let patterns = []
    // Generate URL patterns for context menu matching
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim()
      if (url !== '') {
        // Basic pattern: try to extract hostname
        const clean = url.replace(/^((?:[a-z][a-z0-9+\-.]*:)?\/\/)?(www\.)?/gi, '').split('/')[0]
        if (clean) {
          // Ensure we have a hostname after cleaning
          patterns.push(`*://${clean}/*`)
          patterns.push(`*://www.${clean}/*`)
        }
      }
    }

    if (patterns.length > 0) {
      const uniquePatterns = [...new Set(patterns)] // Remove potential duplicates
      await chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'View page stats on Clicky',
        contexts: ['page', 'link'], // Show on page and links
        documentUrlPatterns: uniquePatterns,
        targetUrlPatterns: uniquePatterns, // Apply to link targets too
      })
      console.log(
        `Context menu created/updated. ID: ${CONTEXT_MENU_ID}, Patterns: ${uniquePatterns.join(
          ', '
        )}`
      )
    } else {
      console.log('Context menu not created: No valid URL patterns found.')
    }
  } catch (error) {
    console.error('Error setting up context menu:', error)
  }
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Handle only clicks for our specific menu item ID
  if (info.menuItemId === 'clickyViewPageStats') {
    console.log('Context menu clicked:', info)
    // Use linkUrl if available (user clicked on a link), otherwise use pageUrl
    const pageUrl = info.linkUrl || info.pageUrl
    if (!pageUrl) {
      console.warn('No URL found in context menu click info.')
      return
    }

    try {
      const data = await chrome.storage.local.get(['clickychrome_urls', 'clickychrome_ids'])
      if (!data.clickychrome_urls || !data.clickychrome_ids) {
        console.warn('Context menu clicked, but no site URLs/IDs found in storage.')
        return // Can't proceed without site config
      }

      const urlArray = data.clickychrome_urls.split(',')
      const idArray = data.clickychrome_ids.split(',')

      // Find the matching site ID based on the clicked URL's hostname
      for (let i = 0; i < urlArray.length; i++) {
        const siteDomain = urlArray[i].trim()
        if (siteDomain === '') continue // Skip empty domains in config

        try {
          // Normalize both clicked URL hostname and configured domain for comparison
          const pageHostname = new URL(pageUrl).hostname.replace(/^www\./i, '')
          const configuredHostname = siteDomain.replace(/^www\./i, '').split('/')[0] // Ensure only hostname

          if (pageHostname === configuredHostname) {
            const siteId = idArray[i] // Get corresponding site ID
            console.log(`Context matched ${configuredHostname}, ID: ${siteId}`)

            // Construct the Clicky stats URL for the specific page path
            const pagePath =
              new URL(pageUrl).pathname + new URL(pageUrl).search + new URL(pageUrl).hash
            // Clicky uses href parameter relative to root, encode it properly
            const contentUrl = `https://getclicky.com/stats/visitors?site_id=${siteId}&href=${encodeURIComponent(
              pagePath
            )}`

            // Open the URL in a new tab
            await chrome.tabs.create({ url: contentUrl, selected: true })
            return // Stop after finding the first match
          }
        } catch (urlError) {
          // Log errors during URL parsing/comparison but continue checking other sites
          console.warn(
            'Could not parse URL or compare for context matching:',
            pageUrl,
            siteDomain,
            urlError
          )
        }
      }
      // If loop completes without finding a match
      console.log(
        'Context menu clicked, but no matching site domain found in config for URL:',
        pageUrl
      )
    } catch (error) {
      console.error('Error handling context menu click:', error)
    }
  }
})

console.log('Clicky Monitor Service Worker Loaded.')
