/**
 * Clicky Monitor - Manifest V3
 * --------------
 * Service Worker based background script with Idle Backoff.
 */

// Define the global namespace *before* importing scripts that rely on it.
self.ClickyChrome = self.ClickyChrome || {} // Ensure ClickyChrome exists globally

// Import utility scripts using importScripts
try {
  // Ensure paths are correct relative to the extension's root directory
  importScripts('functions.js', 'process.js')
} catch (e) {
  console.error('Error importing utility scripts:', e)
}

// Now attach the Background specific object to the global ClickyChrome
ClickyChrome.Background = {}

// --- Constants ---
const ALARM_CHECK_API = 'checkApi'
const ALARM_CLEAN_GOALS = 'cleanGoalLog'
const GOAL_LOG_CLEAN_INTERVAL_MINUTES = 15
const GOAL_LOG_EXPIRY_SECONDS = 900 // 15 minutes
const IDLE_DETECTION_INTERVAL_SECONDS = 15 // Required minimum for chrome.idle
const API_APP_PARAM = 'clickychrome_mv3' // Constant for API calls

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
  t4: 7200, // 120 mins idle -> stay at t4
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
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('Clicky Monitor: Alarm fired:', alarm.name)
  if (alarm.name === ALARM_CHECK_API) {
    // Before checking API, update alarm period based on current idle state
    await updateApiAlarm() // Update period for *next* interval first
    await checkSpy()
  } else if (alarm.name === ALARM_CLEAN_GOALS) {
    cleanGoalLog()
  }
})

// Listen for changes in storage
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    console.log('Clicky Monitor: Storage changed:', changes)
    let needsApiCheck = false
    let needsContextMenuUpdate = false
    let needsBadgeUpdate = false

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

    if (needsApiCheck) {
      console.log('Storage change triggers API check.')
      checkSpy()
    }
    if (needsContextMenuUpdate) {
      console.log('Storage change triggers context menu update.')
      setupContextMenu()
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
  const now = Date.now()

  if (newState === 'active') {
    await chrome.storage.local.set({ lastActiveTimestamp: now })
    const data = await chrome.storage.local.get('currentIntervalLevel')
    const currentLevel = data.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL

    if (currentLevel !== 't1') {
      console.log('User active, resetting API check interval to fastest.')
      await chrome.storage.local.set({ currentIntervalLevel: 't1' })
      await updateApiAlarm() // Update alarm immediately
      await checkSpy() // Trigger immediate check
    } else {
      console.log('User active, already at fastest interval.')
      await checkSpy() // Still run checkSpy to potentially clear 'IDLE' badge
    }
  }
  // No immediate action needed for 'idle' or 'locked' state changes here
})

// Listen for messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let isAsync = false
  switch (message.action) {
    case 'showOptions':
      ClickyChrome.Background.showOptions()
      sendResponse({ status: 'Options tab opened/focused' })
      break
    case 'triggerApiCheck':
      console.log('Received triggerApiCheck message')
      isAsync = true // Indicate async response
      ;(async () => {
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
    // case "getDebugState": // Removed
    //     sendResponse({ debug: false }); // Always false now
    //     break;
    case 'log':
      console.log('LOG from', sender.url ? sender.url : 'popup/options', ':', message.data)
      sendResponse({ status: 'Logged' })
      break
    default:
      sendResponse({ status: 'Unknown action' })
  }
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
    lastActiveTimestamp: Date.now(),
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
    await updateBadgeColor()
  } catch (error) {
    console.error('Error initializing defaults:', error)
  }
}

async function setupCleanGoalAlarm() {
  try {
    await chrome.alarms.create(ALARM_CLEAN_GOALS, {
      delayInMinutes: 1,
      periodInMinutes: GOAL_LOG_CLEAN_INTERVAL_MINUTES,
    })
    console.log(
      `Alarm '${ALARM_CLEAN_GOALS}' created/updated. Interval: ${GOAL_LOG_CLEAN_INTERVAL_MINUTES} minutes.`
    )
  } catch (error) {
    console.error('Error setting up clean goal alarm:', error)
  }
}

async function updateApiAlarm() {
  try {
    const data = await chrome.storage.local.get(['lastActiveTimestamp', 'currentIntervalLevel'])
    const lastActive = data.lastActiveTimestamp || Date.now()
    let currentLevel = data.currentIntervalLevel || DEFAULT_INTERVAL_LEVEL
    const now = Date.now()
    const idleDurationSeconds = Math.floor((now - lastActive) / 1000)

    let newLevel = 't1'
    if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t3) {
      // Use t3 threshold for level 4 interval
      newLevel = 't4'
    } else if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t2) {
      // Use t2 threshold for level 3 interval
      newLevel = 't3'
    } else if (idleDurationSeconds >= CHECK_THRESHOLDS_SECONDS.t1) {
      // Use t1 threshold for level 2 interval
      newLevel = 't2'
    } // else stays t1

    const newPeriodMinutes = SPY_INTERVALS_MINUTES[newLevel]

    if (newLevel !== currentLevel) {
      console.log(
        `Idle duration ${idleDurationSeconds}s. Changing interval level from ${currentLevel} to ${newLevel} (${newPeriodMinutes} min).`
      )
      currentLevel = newLevel
      await chrome.storage.local.set({ currentIntervalLevel: newLevel })
    } else {
      console.log(
        `Idle duration ${idleDurationSeconds}s. Keeping interval level ${currentLevel} (${newPeriodMinutes} min).`
      )
    }

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

    if (newLevel === 't4') {
      // Show IDLE badge only at longest interval
      await chrome.action.setBadgeText({ text: 'IDLE' })
      console.log('Setting IDLE badge.')
    }
  } catch (error) {
    console.error('Error updating API alarm:', error)
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
      console.log('Badge color updated:', colors)
    } else {
      console.error('Invalid badge color format:', colorString)
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
      await chrome.tabs.update(tabs[0].id, { active: true })
      await chrome.windows.update(tabs[0].windowId, { focused: true })
    } else {
      await chrome.tabs.create({ url: optionsUrl, selected: true })
    }
  } catch (error) {
    console.error('Error showing options page:', error)
  }
}

async function checkSpy() {
  // Use Functions. and Process. from the global ClickyChrome object
  if (
    typeof ClickyChrome?.Functions?.setTitle !== 'function' ||
    typeof ClickyChrome?.Process?.goals !== 'function'
  ) {
    console.error('Utility functions not loaded correctly. API check aborted.')
    try {
      await chrome.action.setBadgeText({ text: 'ERR' })
    } catch (e) {}
    return
  }

  console.log('Spy: Fetching API data...')
  let isDeepIdle = false
  try {
    const settings = await chrome.storage.local.get([
      'clickychrome_currentSite',
      'clickychrome_spyType',
      'clickychrome_goalNotification',
      'clickychrome_startTime',
      'currentIntervalLevel',
    ])

    isDeepIdle = settings.currentIntervalLevel === 't4'

    if (!settings.clickychrome_currentSite) {
      console.log('Spy: No current site selected.')
      ClickyChrome.Functions.setTitle('ClickyChrome - No Site Selected')
      if (!isDeepIdle) ClickyChrome.Functions.setBadgeText('')
      return
    }

    const siteInfo = settings.clickychrome_currentSite.split(',')
    const spyType = settings.clickychrome_spyType || 'online'
    const goalNotificationsEnabled = settings.clickychrome_goalNotification === 'yes'
    const startTime = settings.clickychrome_startTime || Date.now()
    const now = Date.now()
    const elapsedSeconds = Math.floor((now - startTime) / 1000)
    let goalTimeOffset = 600
    if (elapsedSeconds < 600) goalTimeOffset = Math.max(0, elapsedSeconds + 30)
    console.log('Goal time offset:', goalTimeOffset)

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

    let apiUrl = `https://api.getclicky.com/api/stats/4?site_id=${siteInfo[0]}&sitekey=${siteInfo[1]}&date=today&output=json&app=${API_APP_PARAM}`
    let types = [apiBadgeType] // Start with the type needed for the badge

    if (goalNotificationsEnabled) {
      if (!types.includes('goals')) types.push('goals')
      if (!types.includes('visitors-list')) types.push('visitors-list')
      apiUrl += `&goal=*&time_offset=${goalTimeOffset}`
    }
    types = [...new Set(types)] // Remove duplicates
    apiUrl += `&type=${types.join(',')}`

    updateTitle(siteInfo, spyType) // Update title based on internal type
    console.log('API URL:', apiUrl)

    const response = await fetch(apiUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = await response.json()
    console.log('API Response (Snippet):', JSON.stringify(data).substring(0, 500) + '...')

    if (data && Array.isArray(data) && data.length > 0) {
      let apiError = null
      for (const item of data) {
        if (item && item.error) {
          apiError = item.error
          break
        }
      }

      if (apiError) {
        console.error('Clicky API Error:', apiError)
        ClickyChrome.Functions.setTitle(`Error: ${apiError}`)
        if (!isDeepIdle) ClickyChrome.Functions.setBadgeText('ERR')
      } else {
        // Process Badge
        let badgeData = data.find((item) => item.type === apiBadgeType)
        let badgeValue = badgeData?.dates?.[0]?.items?.[0]?.value

        if (spyType === 'goals' && badgeValue === undefined) {
          let goalItem = data.find((item) => item.type === 'goals')
          if (!goalItem?.dates?.[0]?.items || goalItem.dates[0].items.length === 0) {
            badgeValue = 0
            console.log('Setting badge to 0 for goals type as no goal items found.')
          }
        }

        if (badgeValue !== undefined) {
          if (!isDeepIdle) {
            ClickyChrome.Functions.setBadgeNum(badgeValue)
            console.log(`Badge updated for ${spyType} (${apiBadgeType}):`, badgeValue)
          } else {
            console.log(`Deep idle state, preserving 'IDLE' badge instead of setting ${badgeValue}`)
          }
        } else {
          console.warn(
            `Could not find value for badge type '${apiBadgeType}' (mapped from '${spyType}') in API response.`
          )
          if (!isDeepIdle) ClickyChrome.Functions.setBadgeText('?')
        }

        // Process Notifications
        if (goalNotificationsEnabled) {
          let goalVisitorData = data.find((item) => item.type === 'visitors-list')
          let goalItems = goalVisitorData?.dates?.[0]?.items
          if (goalItems && goalItems.length > 0) {
            console.log('Goal visitor data found for potential notification:', goalItems.length)
            await processAndCreateNotifications(goalItems)
          } else {
            console.log(
              'Goal notifications enabled, but no goal visitor list data found in response.'
            )
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
    const stateData = await chrome.storage.local.get('currentIntervalLevel')
    if (stateData.currentIntervalLevel !== 't4') {
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
  const siteName = siteInfo?.[2] || 'Unknown Site'
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

    const processedData = ClickyChrome.Process.goals(apiGoalItems, currentLog)

    if (processedData.newGoals && Object.keys(processedData.newGoals).length > 0) {
      const newGoals = processedData.newGoals
      const updatedLog = processedData.updatedLog
      console.log('New goals found for notification:', newGoals)

      await chrome.storage.local.set({ clickychrome_goalLog: updatedLog })

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
        requireInteraction: false,
      }
      if (notificationOptions.type === 'list') notificationOptions.items = notificationItems

      chrome.notifications.create(notificationId, notificationOptions, (createdId) => {
        if (chrome.runtime.lastError) {
          console.error('Error creating notification:', chrome.runtime.lastError.message)
        } else {
          console.log('Notification created:', createdId)
          chrome.storage.local.set({ [`notification_url_${createdId}`]: firstGoal.url })
        }
      })
    } else {
      console.log('No new, unique goals found to notify.')
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
    const CONTEXT_MENU_ID = 'clickyViewPageStats'
    try {
      await chrome.contextMenus.remove(CONTEXT_MENU_ID)
      console.log('Removed existing context menu:', CONTEXT_MENU_ID)
    } catch (removeError) {
      if (!removeError.message.includes('No item with id'))
        console.log('Ctx menu removal error:', removeError.message)
    }

    const data = await chrome.storage.local.get(['clickychrome_urls', 'clickychrome_ids'])
    const urlsString = data.clickychrome_urls
    const idsString = data.clickychrome_ids

    if (!urlsString || !idsString || urlsString.trim() === '' || idsString.trim() === '') {
      console.log('Context menu not created: Missing URLs or IDs.')
      return
    }

    const urls = urlsString.split(',')
    let patterns = []
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim()
      if (url !== '') {
        const clean = url.replace(/^((?:[a-z][a-z0-9+\-.]*:)?\/\/)?(www\.)?/gi, '').split('/')[0]
        if (clean) {
          patterns.push(`*://${clean}/*`)
          patterns.push(`*://www.${clean}/*`)
        }
      }
    }

    if (patterns.length > 0) {
      const uniquePatterns = [...new Set(patterns)]
      await chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'View page stats on Clicky',
        contexts: ['page', 'link'],
        documentUrlPatterns: uniquePatterns,
        targetUrlPatterns: uniquePatterns,
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
  if (info.menuItemId === 'clickyViewPageStats') {
    console.log('Context menu clicked:', info)
    const pageUrl = info.linkUrl || info.pageUrl
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
          const configuredHostname = siteDomain.replace(/^www\./i, '').split('/')[0]
          if (pageHostname === configuredHostname) {
            const siteId = idArray[i]
            console.log(`Context matched ${configuredHostname}, ID: ${siteId}`)
            const pagePath =
              new URL(pageUrl).pathname + new URL(pageUrl).search + new URL(pageUrl).hash
            const contentUrl = `https://getclicky.com/stats/visitors?site_id=${siteId}&href=${encodeURIComponent(
              pagePath
            )}`
            await chrome.tabs.create({ url: contentUrl, selected: true })
            return
          }
        } catch (urlError) {
          console.warn('Could not parse URL for context matching:', pageUrl, urlError)
        }
      }
      console.log('Context menu clicked, but no matching site domain found for URL:', pageUrl)
    } catch (error) {
      console.error('Error handling context menu click:', error)
    }
  }
})

console.log('Clicky Monitor Service Worker Loaded.')
