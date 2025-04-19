/**
 * Clicky Monitor - Options Script (MV3 Compatible)
 * --------------
 * Attaches to the global ClickyChrome object. Debug logging always on.
 */

ClickyChrome.Options = {}

function getFormData(form) {
  const formData = new FormData(form)
  return {
    name: formData.getAll('name[]'),
    url: formData.getAll('url[]'),
    id: formData.getAll('id[]'),
    key: formData.getAll('key[]'),
    badgeColor: formData.get('badgeColor'),
    spyType: formData.get('spyType'),
    goalNotification: formData.get('goalNotification'),
    goalTimeout: formData.get('goalTimeout'),
  }
}

;(async () => {
  // IIFE remains for top-level await
  console.log('Options script loaded.')

  $(async function () {
    // jQuery document ready

    // --- Event Listeners ---
    $('tbody').on('click', '.edit_site', function (e) {
      e.preventDefault()
      $(this).closest('tr').find('.display_value, .input_value').toggleClass('off')
    })
    $('tbody').on('click', '.remove_site', function (e) {
      e.preventDefault()
      $(this).closest('tr').remove()
      ClickyChrome.Options.checkSites()
    })
    $('.add_site').on('click', function (e) {
      e.preventDefault()
      const string = `<tr><td><div class="input_value"><img title="Drag to re-order" class="grip" src="/images/grippy.png" /><input class="input_name" name="name[]" value="" /></div></td><td><div class="input_value"><input class="input_url" name="url[]" value="" /></div></td><td><div class="input_value"><input class="input_id" name="id[]" value="" /></div></td><td><div class="input_value"><input class="input_key" name="key[]" value="" /></div></td><td class="edit"><a href="#" class="remove_site" title="Remove this site">remove</a></td></tr>`
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
    if ($.fn.colorbox) {
      // Check if colorbox plugin exists
      // Original: $('#options_help, #context_help').colorbox({ title: true });

      // Corrected: Use a function to explicitly get the title attribute
      $('#options_help, #context_help').colorbox({
        title: false,
      })
      console.log('Colorbox initialized for help links.')
    } else {
      console.warn('Colorbox not found, help links will open normally.')
      // Fallback behavior if Colorbox isn't loaded
      $('#options_help, #context_help').on('click', function (e) {
        e.preventDefault()
        window.open($(this).attr('href'), '_blank')
      })
    }
    $('#wipe').on('click', async function (e) {
      e.preventDefault()
      if (confirm('Are you sure you want to delete ALL Clicky Monitor data?'))
        await ClickyChrome.Options.wipeData()
    })
    $('#goal_notification').on('change', function () {
      ClickyChrome.Options.checkVis($(this))
    })
    $(document).on('click', '#sample_notification', function (e) {
      e.preventDefault() // Prevent the link's default '#' navigation
      console.log('Sample notification link clicked.')
      // Send message to background script to trigger the sample
      chrome.runtime.sendMessage({ action: 'createSampleNotification' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            'Error sending message for sample notification:',
            chrome.runtime.lastError.message
          )
        } else {
          console.log('Message sent for sample notification, response:', response?.status)
        }
      })
    })

    $('#options_form').on('submit', async function (e) {
      e.preventDefault()
      let missing = 0,
        invalid = 0,
        invalid_name = 0
      const num = $('tbody tr[id!=reminder]').length
      if (num === 0) {
        alert('You must add at least one site.')
        return
      }

      $('tbody tr[id!=reminder]').each(function () {
        /* ... validation ... */ const $row = $(this)
        const nameInput = $row.find('input.input_name')
        const urlInput = $row.find('input.input_url')
        const idInput = $row.find('input.input_id')
        const keyInput = $row.find('input.input_key')
        let nameValue = nameInput.val().trim()
        nameInput.val(nameValue)
        if (nameValue === '') missing = 1
        if (nameValue.includes(',')) invalid_name = 1
        let urlValue = urlInput
          .val()
          .trim()
          .replace(/(^\w+:\/\/)|(\/$)/gi, '')
        urlInput.val(urlValue)
        if (urlValue.includes(',')) invalid_name = 1
        let idValue = idInput.val().trim()
        idInput.val(idValue)
        if (idValue === '') missing = 1
        if (!/^[A-Za-z0-9]+$/.test(idValue) && idValue !== '') invalid = 1
        let keyValue = keyInput.val().trim()
        keyInput.val(keyValue)
        if (keyValue === '') missing = 1
        if (!/^[A-Za-z0-9]+$/.test(keyValue) && keyValue !== '') invalid = 1
      })
      if (missing) {
        alert('Name, Site ID, and Site Key are required for each site.')
        return
      }
      if (invalid_name) {
        alert('Commas are not allowed in Name or Domain fields.')
        return
      }
      if (invalid) {
        alert('Only letters/numbers allowed for Site ID and Site Key.')
        return
      }

      const data = getFormData(this)
      await ClickyChrome.Options.saveData(data)
    })

    $('#import_form').on('submit', async function (e) {
      e.preventDefault()
      $('#import_loader').show()
      $('#import_error').hide().text('')
      const username = $('#username').val()
      const password = $('#password').val()
      const apiString = `https://api.getclicky.com/api/account/sites?username=${encodeURIComponent(
        username
      )}&password=${encodeURIComponent(password)}&output=json&${
        self.API_APP_PARAM || 'app=clickychrome'
      }`
      try {
        console.log('Import API URL:', apiString)
        const response = await fetch(apiString, { cache: 'no-store' })
        let errorText = `HTTP error! status: ${response.status}`
        if (!response.ok) {
          try {
            const d = await response.json()
            if (d && d[0]?.error) errorText = d[0].error
          } catch (e) {}
          throw new Error(errorText)
        }
        const data = await response.json()
        console.log(
          'Import API Response (Snippet):',
          JSON.stringify(data).substring(0, 500) + '...'
        )
        if (data && Array.isArray(data)) {
          if (data[0]?.error) throw new Error(data[0].error)
          const imported = { name: [], url: [], id: [], key: [] }
          data.forEach((site) => {
            imported.name.push(site.nickname || `Site ${site.site_id}`)
            imported.url.push(site.hostname || '')
            imported.id.push(site.site_id)
            imported.key.push(site.sitekey)
          })
          await ClickyChrome.Options.saveImported(imported)
          $('#import').slideUp('slow')
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

    if ($.fn.sortable) {
      // Check if sortable exists
      const fixHelper = (e, ui) => {
        ui.children().each(function () {
          $(this).width($(this).width())
        })
        return ui
      }
      $('tbody').sortable({
        axis: 'y',
        handle: 'img.grip',
        cursor: 'move',
        helper: fixHelper,
        forcePlaceholderSize: true,
        placeholder: 'sortable-placeholder',
        tolerance: 'pointer',
        items: '> tr:not(#reminder)',
      })
      console.log('jQuery UI Sortable initialized.')
    } else {
      console.warn('jQuery UI Sortable not found. Table reordering disabled.')
      $('img.grip').hide()
    }

    await ClickyChrome.Options.init() // Initial load
  }) // End jQuery document ready
})() // End async IIFE

ClickyChrome.Options.init = async function () {
  console.log('Options init started.')
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
    console.log('Loaded data from storage:', data)

    const nameArray = data.clickychrome_names ? data.clickychrome_names.split(',') : []
    const urlArray = data.clickychrome_urls ? data.clickychrome_urls.split(',') : []
    const idArray = data.clickychrome_ids ? data.clickychrome_ids.split(',') : []
    const keyArray = data.clickychrome_keys ? data.clickychrome_keys.split(',') : []
    const maxLength = Math.max(nameArray.length, urlArray.length, idArray.length, keyArray.length)
    while (nameArray.length < maxLength) nameArray.push('')
    while (urlArray.length < maxLength) urlArray.push('')
    while (idArray.length < maxLength) idArray.push('')
    while (keyArray.length < maxLength) keyArray.push('')

    let currentSite = data.clickychrome_currentSite
    if (currentSite) {
      const currentInfo = currentSite.split(',')
      let isValid = false
      if (currentInfo.length === 3) {
        const idx = idArray.indexOf(currentInfo[0])
        if (idx > -1 && keyArray[idx] === currentInfo[1] && nameArray[idx] === currentInfo[2])
          isValid = true
      }
      if (!isValid) {
        console.log('Current site invalid, resetting.')
        currentSite = await this.resetCurrent(idArray, keyArray, nameArray)
      }
    } else if (idArray.length > 0) {
      console.log('No current site set, resetting.')
      currentSite = await this.resetCurrent(idArray, keyArray, nameArray)
    }

    await this.buildSiteTable(nameArray, urlArray, idArray, keyArray)

    const badgeColor = data.clickychrome_badgeColor || '0,0,0,200'
    $(`.color_input[value="${badgeColor}"]`).prop('checked', true)
    const spyType = data.clickychrome_spyType || 'online'
    $(`.spy_type[value="${spyType}"]`).prop('checked', true)
    const goalNotification = data.clickychrome_goalNotification || 'no'
    $('#goal_notification').val(goalNotification)
    this.checkVis($('#goal_notification'))
    const goalTimeout = data.clickychrome_goalTimeout || '10'
    $('#goal_timeout').val(goalTimeout)

    $('#problems, #import').hide()
    $('#import_error').hide()
    $('#username, #password').val('')
    $('#save_feedback').hide()
  } catch (error) {
    console.error('Error initializing options:', error)
  }
}

ClickyChrome.Options.saveData = async function (data) {
  console.log('Saving data:', data)
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
      )
        siteStillExists = true
    }
    if (!siteStillExists && data.id.length > 0) {
      storageData.clickychrome_currentSite = `${data.id[0]},${data.key[0]},${data.name[0]}`
      console.log('Current site reset to first:', storageData.clickychrome_currentSite)
    } else if (data.id.length === 0) {
      storageData.clickychrome_currentSite = ''
      console.log('All sites removed, clearing current site.')
    } else if (currentSite && siteStillExists) {
      storageData.clickychrome_currentSite = currentSite
    }

    await chrome.storage.local.set(storageData)
    await this.init() // Re-initialize UI
    $('#save_feedback').text('Options saved.').removeClass('error').show().delay(3000).fadeOut(500)
    console.log('Options saved successfully.')
  } catch (error) {
    console.error('Error saving options:', error)
    $('#save_feedback').text('Error saving options!').addClass('error').show()
  }
}

ClickyChrome.Options.saveImported = async function (data) {
  console.log('Saving imported data:', data)
  const storageData = {
    clickychrome_names: data.name.join(','),
    clickychrome_urls: data.url.join(','),
    clickychrome_ids: data.id.join(','),
    clickychrome_keys: data.key.join(','),
  }
  if (data.id.length > 0) {
    storageData.clickychrome_currentSite = `${data.id[0]},${data.key[0]},${data.name[0]}`
  } else {
    storageData.clickychrome_currentSite = ''
  }
  try {
    await chrome.storage.local.set(storageData)
    await this.init() // Re-initialize page
    console.log('Imported data saved successfully.')
    alert('Sites imported successfully!')
  } catch (error) {
    console.error('Error saving imported data:', error)
    alert('Error saving imported data.')
  }
}

ClickyChrome.Options.wipeData = async function () {
  console.log('Wiping all extension data...')
  try {
    await chrome.storage.local.clear()
    console.log('Local storage cleared.')
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id) chrome.tabs.remove(tab.id)
      else alert('Data wiped. Please close this tab.')
    })
  } catch (error) {
    console.error('Error wiping data:', error)
    alert('Error wiping data.')
  }
}

ClickyChrome.Options.buildSiteTable = async function (nameArray, urlArray, idArray, keyArray) {
  const tbody = $('tbody')
  tbody.empty()
  if (nameArray.length === 0) {
    this.checkSites()
    return
  }
  for (let i = 0; i < nameArray.length; i++) {
    const esc = (str) => str.replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>')
    const name = nameArray[i] || ''
    const url = urlArray[i] || ''
    const id = idArray[i] || ''
    const key = keyArray[i] || ''
    const string = `<tr><td><div class="display_value"><img title="Drag to re-order" class="grip" src="/images/grippy.png" /> ${esc(
      name
    )}</div><div class="input_value off"><input class="input_name" name="name[]" value="${esc(
      name
    )}" /></div></td><td><div class="display_value">${esc(
      url
    )}</div><div class="input_value off"><input class="input_url" name="url[]" value="${esc(
      url
    )}" /></div></td><td><div class="display_value">${esc(
      id
    )}</div><div class="input_value off"><input class="input_id" name="id[]" value="${esc(
      id
    )}" /></div></td><td><div class="display_value">${esc(
      key
    )}</div><div class="input_value off"><input class="input_key" name="key[]" value="${esc(
      key
    )}" /></div></td><td class="edit"><a href="#" class="edit_site" title="Edit this site">edit</a> | <a href="#" class="remove_site" title="Remove this site">remove</a></td></tr>`
    tbody.append(string)
  }
  if (!$.fn.sortable) $('img.grip').hide() // Hide grips if sortable missing
  this.checkSites()
  console.log('Site table built.')
}

ClickyChrome.Options.checkSites = function () {
  const num = $('tbody tr[id!=reminder]').length
  if (num === 0) {
    if ($('#reminder').length === 0)
      $('tbody').append(
        '<tr id="reminder"><td colspan="5">No sites configured. Use "Add site" or "Import from Clicky".</td></tr>'
      )
  } else {
    $('#reminder').remove()
  }
}

ClickyChrome.Options.resetCurrent = async function (idArray, keyArray, nameArray) {
  let newCurrentSite = ''
  if (idArray && idArray.length > 0) {
    newCurrentSite = `${idArray[0]},${keyArray[0]},${nameArray[0]}`
    try {
      await chrome.storage.local.set({ clickychrome_currentSite: newCurrentSite })
      console.log('Current site reset to:', newCurrentSite)
    } catch (error) {
      console.error('Error saving reset current site:', error)
    }
  } else {
    try {
      await chrome.storage.local.remove('clickychrome_currentSite')
      console.log('Current site cleared as no sites available.')
    } catch (error) {
      console.error('Error removing current site during reset:', error)
    }
  }
  return newCurrentSite
}

ClickyChrome.Options.checkVis = function (el) {
  const timeoutLi = el.closest('li').next('li')
  if (el.val() === 'no') timeoutLi.hide()
  else timeoutLi.show()
}
