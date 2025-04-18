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

ClickyChrome.Options = {}

// Get debug state asynchronously
async function getOptionsDebugState() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDebugState' })
    return response?.debug || false
  } catch (error) {
    console.error('Error getting debug state in options.js:', error)
    return false
  }
}

// Utility to get form data into structured object (simple version)
function getFormData(form) {
  const formData = new FormData(form)
  const data = {
    name: formData.getAll('name[]'),
    url: formData.getAll('url[]'),
    id: formData.getAll('id[]'),
    key: formData.getAll('key[]'),
    badgeColor: formData.get('badgeColor'),
    spyType: formData.get('spyType'),
    goalNotification: formData.get('goalNotification'),
    goalTimeout: formData.get('goalTimeout'),
  }
  return data
}

// Wrap in async IIFE
;(async () => {
  ClickyChrome.Options.debug = await getOptionsDebugState()
  if (ClickyChrome.Options.debug) console.log('Options script loaded.')

  $(async function () {
    // jQuery document ready

    // --- Event Listeners ---
    $('tbody').on('click', '.edit_site', function (e) {
      e.preventDefault()
      $(this).closest('tr').find('.display_value').toggleClass('off')
      $(this).closest('tr').find('.input_value').toggleClass('off')
      // Maybe change text to 'cancel' or hide edit? Simpler to just toggle.
    })

    $('tbody').on('click', '.remove_site', function (e) {
      e.preventDefault()
      $(this).closest('tr').remove()
      ClickyChrome.Options.checkSites() // Update reminder message if needed
    })

    $('.add_site').on('click', function (e) {
      e.preventDefault()
      // Add a new row with input fields visible
      const string = `
                <tr>
                    <td>
                        <div class="input_value">
                         <img title="Drag to re-order" class="grip" src="/images/grippy.png" />
                         <input class="input_name" name="name[]" value="" />
                        </div>
                    </td>
                    <td><div class="input_value"><input class="input_url" name="url[]" value="" /></div></td>
                    <td><div class="input_value"><input class="input_id" name="id[]" value="" /></div></td>
                    <td><div class="input_value"><input class="input_key" name="key[]" value="" /></div></td>
                    <td class="edit"><a href="#" class="remove_site" title="Remove this site">remove</a></td>
                </tr>`
      $('tbody').append(string)
      ClickyChrome.Options.checkSites()
    })

    $('#toggle_problems').on('click', function (e) {
      e.preventDefault()
      $('#problems').slideToggle('slow')
    })
    $('#toggle_import').on('click', function (e) {
      e.preventDefault()
      $('#import').slideToggle('slow')
    })

    // Ensure colorbox is initialized correctly if still used
    if ($.fn.colorbox) {
      $('#options_help, #context_help').colorbox({ title: true })
    } else {
      console.warn('Colorbox not found, help links will open normally.')
      $('#options_help, #context_help').on('click', function (e) {
        e.preventDefault()
        window.open($(this).attr('href'), '_blank')
      })
    }

    $('#wipe').on('click', async function (e) {
      e.preventDefault()
      if (
        confirm(
          'Are you sure you want to delete ALL Clicky Monitor data and settings? This cannot be undone.'
        )
      ) {
        await ClickyChrome.Options.wipeData()
      }
    })

    $('#goal_notification').on('change', function () {
      ClickyChrome.Options.checkVis($(this))
    })

    // Sample notification trigger uses message passing
    $('#sample_notification').on('click', function (e) {
      e.preventDefault()
      chrome.runtime.sendMessage({ action: 'createSampleNotification' })
    })

    // Main options form submission
    $('#options_form').on('submit', async function (e) {
      e.preventDefault()
      let missing = 0,
        invalid = 0,
        invalid_name = 0
      const num = $('tbody tr[id!=reminder]').length

      if (num === 0) {
        alert('You must add at least one site to use this extension.')
        return
      }

      // --- Validation ---
      $('tbody tr[id!=reminder]').each(function () {
        const $row = $(this)
        const nameInput = $row.find('input.input_name')
        const urlInput = $row.find('input.input_url')
        const idInput = $row.find('input.input_id')
        const keyInput = $row.find('input.input_key')

        // Validate Name
        let nameValue = nameInput.val().trim()
        nameInput.val(nameValue)
        if (nameValue === '') missing = 1
        if (nameValue.includes(',')) invalid_name = 1

        // Validate URL (and clean it)
        let urlValue = urlInput
          .val()
          .trim()
          .replace(/(^\w+:\/\/)|(\/$)/gi, '')
        urlInput.val(urlValue) // Update input with cleaned value
        if (urlValue.includes(',')) invalid_name = 1 // Comma check

        // Validate ID
        let idValue = idInput.val().trim()
        idInput.val(idValue)
        if (idValue === '') missing = 1
        if (!/^[A-Za-z0-9]+$/.test(idValue) && idValue !== '') invalid = 1 // Allow empty only if row is new? No, require it.

        // Validate Key
        let keyValue = keyInput.val().trim()
        keyInput.val(keyValue)
        if (keyValue === '') missing = 1
        if (!/^[A-Za-z0-9]+$/.test(keyValue) && keyValue !== '') invalid = 1
      })

      if (missing === 1) {
        alert('You must enter a Name, Site ID, and Site Key for each site.')
        return
      }
      if (invalid_name === 1) {
        alert('Commas are not allowed in the Name or Domain fields.')
        return
      }
      if (invalid === 1) {
        alert('Only letters and numbers are allowed for Site ID and Site Key fields.')
        return
      }

      // If validation passes
      const data = getFormData(this) // Use helper to get form data
      await ClickyChrome.Options.saveData(data)
    })

    // Import form submission
    $('#import_form').on('submit', async function (e) {
      e.preventDefault()
      $('#import_loader').show()
      $('#import_error').hide().text('') // Reset error

      const username = $('#username').val()
      const password = $('#password').val()

      // Use fetch instead of $.ajax
      const apiString = `https://api.getclicky.com/api/account/sites?username=${encodeURIComponent(
        username
      )}&password=${encodeURIComponent(password)}&output=json&app=clickychrome`

      try {
        if (ClickyChrome.Options.debug) console.log('Import API URL:', apiString)
        const response = await fetch(apiString, { cache: 'no-store' })

        if (!response.ok) {
          // Try to get error message from body if available
          let errorText = `HTTP error! status: ${response.status}`
          try {
            const errorData = await response.json()
            if (errorData && errorData[0]?.error) {
              errorText = errorData[0].error
            }
          } catch (parseError) {
            /* Ignore if response is not JSON */
          }
          throw new Error(errorText)
        }

        const data = await response.json()
        if (ClickyChrome.Options.debug) console.log('Import API Response:', JSON.stringify(data))

        if (data && Array.isArray(data) && data[0]) {
          if (data[0].error) {
            throw new Error(data[0].error) // Throw API specific error
          } else {
            // Process successful import
            const imported = { name: [], url: [], id: [], key: [] }
            data.forEach((site) => {
              // Sometimes nickname or hostname might be null/missing
              imported.name.push(site.nickname || `Site ${site.site_id}`)
              imported.url.push(site.hostname || '')
              imported.id.push(site.site_id)
              imported.key.push(site.sitekey)
            })
            await ClickyChrome.Options.saveImported(imported) // Save and reload table
            $('#import').slideUp('slow') // Hide import section on success
          }
        } else {
          throw new Error('Received invalid data from import API.')
        }
      } catch (error) {
        console.error('Import Error:', error)
        $('#import_error').show().text(`Import failed: ${error.message}`)
      } finally {
        $('#import_loader').hide()
      }
    })

    // --- Make table sortable (requires jQuery UI) ---
    // Check if jQuery UI sortable is loaded
    if ($.fn.sortable) {
      // Helper function to keep cell widths during drag
      const fixHelper = function (e, ui) {
        ui.children().each(function () {
          $(this).width($(this).width())
        })
        return ui
      }

      $('tbody').sortable({
        axis: 'y',
        handle: 'img.grip', // Ensure handle selector is specific
        cursor: 'move',
        helper: fixHelper,
        forcePlaceholderSize: true,
        placeholder: 'sortable-placeholder', // Add a class for styling the placeholder
        tolerance: 'pointer',
        items: '> tr:not(#reminder)', // Exclude the reminder row
      })
      if (ClickyChrome.Options.debug) console.log('jQuery UI Sortable initialized.')
    } else {
      console.warn('jQuery UI Sortable not found. Table reordering disabled.')
      // Optionally hide the drag handles if sortable is not available
      $('img.grip').hide()
    }

    // --- Initial Load ---
    await ClickyChrome.Options.init()
  }) // End jQuery document ready
})() // End async IIFE

/**
 * Initialize options page state from chrome.storage
 */
ClickyChrome.Options.init = async function () {
  if (ClickyChrome.Options.debug) console.log('Options init started.')
  try {
    const data = await chrome.storage.local.get([
      'clickychrome_names',
      'clickychrome_urls',
      'clickychrome_ids',
      'clickychrome_keys',
      'clickychrome_currentSite',
      'clickychrome_badgeColor',
      'clickychrome_spyType',
      'clickychrome_goalNotification',
      'clickychrome_goalTimeout',
    ])

    if (ClickyChrome.Options.debug) console.log('Loaded data from storage:', data)

    // Populate site table
    const nameArray = data.clickychrome_names ? data.clickychrome_names.split(',') : []
    const urlArray = data.clickychrome_urls ? data.clickychrome_urls.split(',') : []
    const idArray = data.clickychrome_ids ? data.clickychrome_ids.split(',') : []
    const keyArray = data.clickychrome_keys ? data.clickychrome_keys.split(',') : []

    // Ensure arrays have the same length, padding with empty strings if needed (though saving should prevent this)
    const maxLength = Math.max(nameArray.length, urlArray.length, idArray.length, keyArray.length)
    while (nameArray.length < maxLength) nameArray.push('')
    while (urlArray.length < maxLength) urlArray.push('')
    while (idArray.length < maxLength) idArray.push('')
    while (keyArray.length < maxLength) keyArray.push('')

    // Check validity of currentSite and reset if necessary
    let currentSite = data.clickychrome_currentSite
    if (currentSite) {
      const currentSiteInfo = currentSite.split(',')
      let isValid = false
      if (currentSiteInfo.length === 3) {
        const siteIndex = idArray.indexOf(currentSiteInfo[0])
        if (
          siteIndex > -1 &&
          keyArray[siteIndex] === currentSiteInfo[1] &&
          nameArray[siteIndex] === currentSiteInfo[2]
        ) {
          isValid = true
        }
      }
      if (!isValid) {
        if (ClickyChrome.Options.debug) console.log('Current site invalid, resetting.')
        currentSite = await this.resetCurrent(idArray, keyArray, nameArray) // Reset and get new value
      }
    } else if (idArray.length > 0) {
      if (ClickyChrome.Options.debug) console.log('No current site set, resetting.')
      currentSite = await this.resetCurrent(idArray, keyArray, nameArray)
    }

    await this.buildSiteTable(nameArray, urlArray, idArray, keyArray)

    // Set option controls
    const badgeColor = data.clickychrome_badgeColor || '0,0,0,200'
    $(`.color_input[value="${badgeColor}"]`).prop('checked', true)

    const spyType = data.clickychrome_spyType || 'online'
    $(`.spy_type[value="${spyType}"]`).prop('checked', true)

    const goalNotification = data.clickychrome_goalNotification || 'no'
    $('#goal_notification').val(goalNotification)
    this.checkVis($('#goal_notification')) // Show/hide timeout based on initial value

    const goalTimeout = data.clickychrome_goalTimeout || '10'
    $('#goal_timeout').val(goalTimeout)

    // Hide sections initially
    $('#problems, #import').hide() // Use hide() instead of slideUp for initial state
    $('#import_error').hide()
    $('#username, #password').val('') // Clear import fields
    $('#save_feedback').hide() // Hide save feedback initially
  } catch (error) {
    console.error('Error initializing options:', error)
    // Display an error message to the user?
  }
}

/**
 * Saves options data to chrome.storage
 */
ClickyChrome.Options.saveData = async function (data) {
  if (this.debug) console.log('Saving data:', data)

  // Prepare data for storage
  const storageData = {
    clickychrome_names: data.name.join(','),
    clickychrome_urls: data.url.join(','),
    clickychrome_ids: data.id.join(','),
    clickychrome_keys: data.key.join(','),
    clickychrome_badgeColor: data.badgeColor,
    clickychrome_spyType: data.spyType,
    clickychrome_goalNotification: data.goalNotification,
    clickychrome_goalTimeout: data.goalTimeout,
  }

  try {
    // Check if currentSite needs updating (if the site it points to was removed or changed)
    const currentSiteData = await chrome.storage.local.get('clickychrome_currentSite')
    let currentSite = currentSiteData.clickychrome_currentSite
    let siteStillExists = false
    if (currentSite) {
      const currentInfo = currentSite.split(',')
      const currentIndex = storageData.clickychrome_ids.split(',').indexOf(currentInfo[0])
      if (
        currentIndex > -1 &&
        storageData.clickychrome_keys.split(',')[currentIndex] === currentInfo[1] &&
        storageData.clickychrome_names.split(',')[currentIndex] === currentInfo[2]
      ) {
        siteStillExists = true
      }
    }

    // If current site is gone or never existed, set to the first available site
    if (!siteStillExists && data.id.length > 0) {
      storageData.clickychrome_currentSite = `${data.id[0]},${data.key[0]},${data.name[0]}`
      if (this.debug)
        console.log(
          'Current site was removed or invalid, resetting to first site:',
          storageData.clickychrome_currentSite
        )
    } else if (data.id.length === 0) {
      // If all sites removed, clear currentSite
      storageData.clickychrome_currentSite = ''
      if (this.debug) console.log('All sites removed, clearing current site.')
    } else {
      // Keep existing valid currentSite if it still exists
      if (currentSite && siteStillExists) {
        storageData.clickychrome_currentSite = currentSite
      }
    }

    await chrome.storage.local.set(storageData)

    // Re-initialize the options page UI to reflect saved state and order
    await this.init()

    $('#save_feedback')
      .text('Options saved.')
      .show()
      .delay(3000) // Shorter delay
      .fadeOut(500)

    // No need to manually call background init - background listens for storage changes.
    if (this.debug) console.log('Options saved successfully.')
  } catch (error) {
    console.error('Error saving options:', error)
    $('#save_feedback')
      .text('Error saving options!')
      .addClass('error') // Add error styling if available
      .show()
  }
}

/**
 * Saves imported site data, overwriting existing sites.
 */
ClickyChrome.Options.saveImported = async function (data) {
  if (this.debug) console.log('Saving imported data:', data)

  const storageData = {
    clickychrome_names: data.name.join(','),
    clickychrome_urls: data.url.join(','),
    clickychrome_ids: data.id.join(','),
    clickychrome_keys: data.key.join(','),
  }

  // Set current site to the first imported site, if any
  if (data.id.length > 0) {
    storageData.clickychrome_currentSite = `${data.id[0]},${data.key[0]},${data.name[0]}`
  } else {
    storageData.clickychrome_currentSite = '' // Clear if import resulted in no sites
  }

  try {
    await chrome.storage.local.set(storageData)

    // Re-initialize the page to show the new sites
    await this.init()

    if (this.debug) console.log('Imported data saved successfully.')
    // Optionally show feedback to the user
    alert('Sites imported successfully!')
  } catch (error) {
    console.error('Error saving imported data:', error)
    alert('Error saving imported data. Please check console.')
  }
}

/**
 * Wipes all Clicky Monitor data from chrome.storage.
 */
ClickyChrome.Options.wipeData = async function () {
  if (this.debug) console.log('Wiping all extension data...')
  try {
    // Could remove specific keys, but clear() is simpler
    await chrome.storage.local.clear()
    if (this.debug) console.log('Local storage cleared.')

    // Optional: Clear sync storage too if it were used
    // await chrome.storage.sync.clear();

    // Close the options tab after wiping
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id) {
        chrome.tabs.remove(tab.id)
      } else {
        // Fallback if cannot get current tab (e.g., if opened directly via URL)
        alert('Data wiped. Please close this tab manually.')
      }
    })

    // Background will re-initialize on next event or browser start
  } catch (error) {
    console.error('Error wiping data:', error)
    alert('Error wiping data. Please check console.')
  }
}

/**
 * Builds the HTML table for sites.
 */
ClickyChrome.Options.buildSiteTable = async function (nameArray, urlArray, idArray, keyArray) {
  const tbody = $('tbody')
  tbody.empty() // Clear existing rows

  if (nameArray.length === 0) {
    this.checkSites() // Show reminder if no sites
    return
  }

  for (let i = 0; i < nameArray.length; i++) {
    // Escape values to prevent basic HTML injection issues in value attributes
    const esc = (str) => str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const name = nameArray[i] || ''
    const url = urlArray[i] || ''
    const id = idArray[i] || ''
    const key = keyArray[i] || ''

    // Create both display and input elements, toggle visibility with 'off' class
    const string = `
            <tr>
                <td>
                    <div class="display_value">
                        <img title="Drag to re-order" class="grip" src="/images/grippy.png" />
                        ${esc(name)}
                     </div>
                    <div class="input_value off"><input class="input_name" name="name[]" value="${esc(
                      name
                    )}" /></div>
                </td>
                <td>
                    <div class="display_value">${esc(url)}</div>
                    <div class="input_value off"><input class="input_url" name="url[]" value="${esc(
                      url
                    )}" /></div>
                </td>
                <td>
                    <div class="display_value">${esc(id)}</div>
                    <div class="input_value off"><input class="input_id" name="id[]" value="${esc(
                      id
                    )}" /></div>
                </td>
                <td>
                    <div class="display_value">${esc(key)}</div>
                    <div class="input_value off"><input class="input_key" name="key[]" value="${esc(
                      key
                    )}" /></div>
                </td>
                <td class="edit">
                     <a href="#" class="edit_site" title="Edit this site">edit</a> |
                     <a href="#" class="remove_site" title="Remove this site">remove</a>
                </td>
            </tr>`
    tbody.append(string)
  }
  // Hide grip handles if sortable isn't available (check moved to init)
  if (!$.fn.sortable) {
    $('img.grip').hide()
  }

  this.checkSites() // Remove reminder if sites were added
  if (this.debug) console.log('Site table built.')
}

/**
 * Shows or hides the reminder message if no sites are configured.
 */
ClickyChrome.Options.checkSites = function () {
  const num = $('tbody tr[id!=reminder]').length
  if (num === 0) {
    if ($('#reminder').length === 0) {
      // Add reminder only if it doesn't exist
      const string =
        '<tr id="reminder"><td colspan="5">You must add at least one site from your Clicky account to use this extension. Use "Add site" or "Import from Clicky".</td></tr>'
      $('tbody').append(string)
    }
  } else {
    $('#reminder').remove() // Remove reminder if sites exist
  }
}

/**
 * Sets the current site to the first available site and saves it.
 * Returns the new currentSite string.
 */
ClickyChrome.Options.resetCurrent = async function (idArray, keyArray, nameArray) {
  let newCurrentSite = ''
  if (idArray && idArray.length > 0) {
    newCurrentSite = `${idArray[0]},${keyArray[0]},${nameArray[0]}`
    try {
      await chrome.storage.local.set({ clickychrome_currentSite: newCurrentSite })
      if (this.debug) console.log('Current site reset to:', newCurrentSite)
    } catch (error) {
      console.error('Error saving reset current site:', error)
    }
  } else {
    // No sites available, clear currentSite
    try {
      await chrome.storage.local.remove('clickychrome_currentSite')
      if (this.debug) console.log('Current site cleared as no sites available.')
    } catch (error) {
      console.error('Error removing current site during reset:', error)
    }
  }
  return newCurrentSite
}

/**
 * Shows/hides the Goal Timeout dropdown based on Goal Notification selection.
 */
ClickyChrome.Options.checkVis = function (el) {
  const timeoutLi = el.closest('li').next('li') // Find the next li (containing timeout)
  if (el.val() === 'no') {
    timeoutLi.hide()
  } else {
    timeoutLi.show()
  }
}
