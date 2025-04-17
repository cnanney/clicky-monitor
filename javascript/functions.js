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
 * Shared helper functions. No direct use of localStorage or background state.
 * Uses chrome.action instead of chrome.browserAction.
 */

var ClickyChrome = ClickyChrome || {}
ClickyChrome.Functions = {}

/**
 * Returns abbreviation for numbers, e.g., 1500 -> 1.5k
 * (Simplified from original for badge display)
 *
 * @param {number | string} n - Number to abbreviate.
 * @returns {string} Abbreviated number string or original if small.
 */
ClickyChrome.Functions.abvNum = function (n) {
  try {
    const num = Number(n)
    if (isNaN(num)) return '?' // Handle non-numeric input

    if (num < 1000) {
      return num.toString()
    } else if (num < 10000) {
      // Show one decimal place for 1k-9.9k
      return (num / 1000).toFixed(1) + 'k'
    } else if (num < 1000000) {
      // Show integer for 10k-999k
      return Math.floor(num / 1000) + 'k'
    } else {
      // Show >1m for millions
      return '>1m'
    }
  } catch (e) {
    console.error('Error in abvNum:', e)
    return '?'
  }
}

/**
 * Returns nicely formatted time string, e.g., 90 -> 1m 30s
 *
 * @param {number | string} s - Seconds to parse.
 * @returns {string} Formatted time string.
 */
ClickyChrome.Functions.abvTime = function (s) {
  try {
    const sec = Number(s)
    if (isNaN(sec) || sec < 0) return 'N/A'

    const hours = Math.floor(sec / 3600)
    const minutes = Math.floor((sec % 3600) / 60)
    const seconds = Math.floor(sec % 60) // Use floor to avoid decimals

    let parts = []
    if (hours > 0) parts.push(hours + 'h')
    if (minutes > 0) parts.push(minutes + 'm')
    // Always show seconds if total time is less than a minute, or if there are remaining seconds
    if (sec < 60 || seconds > 0) parts.push(seconds + 's')

    return parts.join(' ') || '0s' // Return '0s' if input is 0
  } catch (e) {
    console.error('Error in abvTime:', e)
    return 'N/A'
  }
}

/**
 * Returns a number formatted with commas, e.g. 1234 -> 1,234
 *
 * @param {number | string} n - Number to format.
 * @returns {string} Formatted number string.
 */
ClickyChrome.Functions.addCommas = function (n) {
  try {
    const num = Number(n)
    if (isNaN(num)) return n?.toString() || '' // Return original if not a number

    return num.toLocaleString('en-US') // Use built-in locale string for formatting
  } catch (e) {
    console.error('Error in addCommas:', e)
    // Fallback to simple string conversion
    return n?.toString() || ''
  }
}

/**
 * Opens a new tab in Chrome and makes it active.
 * (This function might not be needed if popup.js handles external links directly)
 * Kept for potential use by background/options.
 *
 * @param {string} url - URL to open.
 */
ClickyChrome.Functions.openUrl = function (url) {
  if (!url) {
    console.error('openUrl called with no URL.')
    return
  }
  chrome.tabs.create({ url: url, selected: true })
}

/**
 * Sets action title (tooltip).
 *
 * @param {string} text - Text to set.
 */
ClickyChrome.Functions.setTitle = function (text) {
  const strText = text ? text.toString() : ''
  chrome.action.setTitle({ title: strText })
}

/**
 * Sets action badge text.
 *
 * @param {string} text - Text to set.
 */
ClickyChrome.Functions.setBadgeText = function (text) {
  const strText = text ? text.toString() : ''
  // Limit badge text length (Chrome enforces limits anyway, but good practice)
  const badgeText = strText.length > 4 ? strText.substring(0, 3) + '…' : strText
  chrome.action.setBadgeText({ text: badgeText })
}

/**
 * Updates action badge with a number, abbreviating if large.
 *
 * @param {number | string} n - The number to display.
 */
ClickyChrome.Functions.setBadgeNum = function (n) {
  try {
    const num = Number(n)
    if (isNaN(num) || num <= 0) {
      this.setBadgeText('') // Clear badge for 0 or invalid numbers
    } else {
      this.setBadgeText(this.abvNum(num))
    }
  } catch (e) {
    console.error('Error in setBadgeNum:', e)
    this.setBadgeText('?') // Indicate error on badge
  }
}

// setBadgeColor is now handled directly in background.js using chrome.action.setBadgeBackgroundColor

/**
 * Returns size of an object (number of own enumerable properties).
 *
 * @param {object} obj - Object to check size of.
 * @returns {number} Size of the object.
 */
ClickyChrome.Functions.objectSize = function (obj) {
  if (!obj || typeof obj !== 'object') {
    return 0
  }
  return Object.keys(obj).length
}

// --- Raphael Chart Drawing Functions ---
// These assume Raphael.js is loaded in the popup context (popup.html)
// They remain largely unchanged structurally but ensure data is passed correctly.

/**
 * Draws browser pie chart using Raphael JS library.
 *
 * @param {array} d - Data array (percentages).
 * @param {array} l - Label array (browser names).
 * @param {array} u - URL array (links for slices).
 */
ClickyChrome.Functions.drawPie = function (d, l, u) {
  try {
    if (typeof Raphael === 'undefined') throw new Error('Raphael library not loaded.')
    if (!document.getElementById('chart')) throw new Error('Chart container element not found.')

    $('#chart').empty() // Clear previous chart
    const r = Raphael('chart') // Specify container ID
    // Colors (keep original colors)
    const colors = [
      '#6195e1',
      '#6b9be1',
      '#78a3e1',
      '#87ace1',
      '#97b5e1',
      '#a7bfe1',
      '#b7c8e1',
      '#c6d1e1',
      '#d3d9e1',
      '#dddfe1',
    ]
    // Format labels for legend
    const legendLabels = l.map((label) => `%%.% - ${label}`)

    const pie = r.piechart(150, 100, 80, d, {
      // Adjusted center X for potentially smaller popup? Check layout.
      legend: legendLabels,
      legendpos: 'west', // Keep legend position
      colors: colors.slice(0, d.length), // Use only needed colors
      href: u,
      strokewidth: 1, // Add a small stroke for definition
      stroke: '#fff',
    })

    // Add hover effects (same as original)
    pie.hover(
      function () {
        this.sector
          .stop()
          .animate({ transform: 's1.1 1.1 ' + this.cx + ' ' + this.cy }, 500, 'elastic')
        if (this.label) {
          this.label[0].stop().animate({ scale: 1.5 }, 500, 'elastic')
          this.label[1].attr({ 'font-weight': 800 })
        }
      },
      function () {
        this.sector.stop().animate({ transform: '' }, 500, 'elastic') // Reset transform
        if (this.label) {
          this.label[0].stop().animate({ scale: 1 }, 500, 'elastic')
          this.label[1].attr({ 'font-weight': 400 })
        }
      }
    )
    console.log('Pie chart drawn successfully.')
  } catch (error) {
    console.error('Error drawing pie chart:', error)
    $('#chart').html('<p>Error drawing chart.</p>') // Show error in chart area
  }
}

/**
 * Draws line charts for visitors and actions using Raphael JS library.
 *
 * @param {string} d - Comma-separated data string.
 * @param {string} l - Comma-separated label string (dates).
 * @param {string} t - Type of chart ('visitors' or 'actions').
 */
ClickyChrome.Functions.drawChart = function (d, l, t) {
  try {
    if (typeof Raphael === 'undefined') throw new Error('Raphael library not loaded.')
    if (!document.getElementById('chart')) throw new Error('Chart container element not found.')
    if (!d || !l) throw new Error('Missing data or labels for line chart.')

    $('#chart').empty() // Clear previous chart

    // --- Chart Configuration (mostly from original) ---
    const lineInfo = {
      visitors: { metricSingular: 'Visitor', metricPlural: 'Visitors', mainColor: '#5D93E1' },
      actions: { metricSingular: 'Action', metricPlural: 'Actions', mainColor: '#F80' },
    }
    const months = {
      '01': 'Jan',
      '02': 'Feb',
      '03': 'Mar',
      '04': 'Apr',
      '05': 'May',
      '06': 'Jun',
      '07': 'Jul',
      '08': 'Aug',
      '09': 'Sep',
      10: 'Oct',
      11: 'Nov',
      12: 'Dec',
    }
    const data = d.split(',').map(Number) // Convert data to numbers
    const labels = l.split(',')

    if (data.length !== labels.length || data.length === 0) {
      throw new Error('Data and label lengths mismatch or are empty.')
    }

    // Dimensions and Gutters (adjust if needed for popup size)
    const width = 400
    const height = 188
    const topGutter = 20
    const bottomGutter = 30 // Increased for labels
    const maxVal = Math.max(...data, 0) // Ensure max is at least 0
    const maxValLength = Math.max(maxVal, 1).toString().length // Use length of max value (or 1 if max is 0)
    const leftGutter = Math.max(25, maxValLength * 7 + 10) // Dynamic left gutter based on max value length

    // Axis Splits
    const hSplit = Math.min(5, data.length - 1) // Max 5 horizontal divisions, ensure > 0
    const vSplit = 4 // Vertical divisions

    // Grid/Line/Point Styles
    const gridColor = '#ddd'
    const gridWidth = 0.5
    const lineWidth = 2
    const lineColor = lineInfo[t]?.mainColor || '#000'
    const pointRadius = 0 // No points by default
    const pointHoverRadius = 4
    const showFill = true
    const fillOpacity = 0.1

    // Text Styles
    const txtData = { font: '10px Arial, sans-serif', fill: '#333', 'text-anchor': 'end' }
    const txtLabels = { font: '10px Arial, sans-serif', fill: '#666', 'text-anchor': 'middle' } // Center x-axis labels
    const txtHoverPopup = { font: 'bold 11px Arial, sans-serif', fill: '#000' }
    const txtHoverDate = { font: '10px Arial, sans-serif', fill: '#333' }

    // Hover Popup Styles
    const hoverStrokeWidth = 1
    const hoverStrokeColor = '#ccc'
    const hoverFillColor = '#fff'

    // --- Calculations ---
    const X = (width - leftGutter) / (labels.length > 1 ? labels.length - 1 : 1) // Avoid division by zero if only one point
    const Y = (height - bottomGutter - topGutter) / (maxVal > 0 ? maxVal : 1) // Avoid division by zero if max is 0

    // --- Initialize Raphael ---
    const r = Raphael('chart', width, height)

    // --- Draw Y-axis Labels and Grid ---
    const rH = (height - topGutter - bottomGutter) / vSplit // Height of each vertical section
    for (let i = 0; i <= vSplit; i++) {
      const yPos = topGutter + i * rH
      const yLabel = Math.round(maxVal * (1 - i / vSplit)) // Calculate label value
      r.text(leftGutter - 6, yPos, this.addCommas(yLabel)).attr(txtData)
      // Horizontal grid line
      if (i > 0 && i < vSplit) {
        // Don't draw top/bottom lines over potential border
        r.path(`M${leftGutter},${yPos}H${width}`).attr({
          stroke: gridColor,
          'stroke-width': gridWidth,
          'stroke-dasharray': '.',
        })
      }
    }

    // --- Draw X-axis Labels and Grid ---
    const xLabelPoints = [] // Store x positions for vertical grid lines
    const labelStep = Math.max(1, Math.floor(labels.length / (hSplit + 1))) // Determine label frequency
    for (let i = 0; i < labels.length; i++) {
      const xPos = leftGutter + i * X
      if (i % labelStep === 0 || i === labels.length - 1) {
        // Show first, last, and intermediate labels
        const dateParts = labels[i].split('-') // YYYY-MM-DD
        const labelText = `${months[dateParts[1]]} ${parseInt(dateParts[2])}` // Format as "Mon DD"
        r.text(xPos, height - bottomGutter + 12, labelText).attr(txtLabels)
        xLabelPoints.push(xPos)
        // Vertical grid line
        if (xPos > leftGutter) {
          // Don't draw at the very beginning
          r.path(`M${xPos},${topGutter}V${height - bottomGutter}`).attr({
            stroke: gridColor,
            'stroke-width': gridWidth,
            'stroke-dasharray': '.',
          })
        }
      }
    }

    // --- Prepare Path Strings ---
    let pathString = `M${leftGutter},${height - bottomGutter - Y * data[0]}`
    let fillString = `M${leftGutter},${height - bottomGutter}L${leftGutter},${
      height - bottomGutter - Y * data[0]
    }`

    for (let i = 1; i < labels.length; i++) {
      const x = leftGutter + i * X
      const y = height - bottomGutter - Y * data[i]
      pathString += `L${x},${y}`
      fillString += `L${x},${y}`
    }
    fillString += `L${leftGutter + (labels.length - 1) * X},${height - bottomGutter}Z` // Close fill path

    // --- Draw Fill and Line ---
    if (showFill && data.length > 1) {
      r.path(fillString).attr({ stroke: 'none', fill: lineColor, opacity: fillOpacity })
    }
    if (data.length > 0) {
      // Draw line only if data exists
      r.path(pathString).attr({
        stroke: lineColor,
        'stroke-width': lineWidth,
        'stroke-linejoin': 'round',
      })
    }

    // --- Draw Hover Effects ---
    const cover = r
      .rect(leftGutter, topGutter, width - leftGutter, height - topGutter - bottomGutter)
      .attr({ fill: '#fff', opacity: 0 }) // Invisible cover rect for hover
    const popup = r.set() // Set for popup elements (frame, text)
    const frame = r
      .rect(0, 0, 100, 40, 5)
      .attr({ fill: hoverFillColor, stroke: hoverStrokeColor, 'stroke-width': hoverStrokeWidth })
      .hide()
    const hoverLabelVal = r.text(0, 0, '').attr(txtHoverPopup).hide()
    const hoverLabelDate = r.text(0, 0, '').attr(txtHoverDate).hide()
    popup.push(frame, hoverLabelVal, hoverLabelDate)

    let currentDot = null // To track the active hover dot

    cover.mousemove(function (event) {
      const bb = cover.getBBox()
      const mouseX = event.offsetX || event.layerX // Get mouse X relative to SVG container
      const graphX = mouseX - bb.x // Mouse X relative to graph area
      const pointIndex = Math.round(graphX / X)

      if (pointIndex >= 0 && pointIndex < data.length) {
        const x = leftGutter + pointIndex * X
        const y = height - bottomGutter - Y * data[pointIndex]
        const val = data[pointIndex]
        const dateLabel = labels[pointIndex]

        // Update or create hover dot
        if (!currentDot) {
          currentDot = r.circle(x, y, pointHoverRadius).attr({ fill: lineColor, stroke: 'none' })
        } else {
          currentDot.attr({ cx: x, cy: y }).show()
        }

        // Format popup text
        const valText = `${ClickyChrome.Functions.addCommas(val)} ${
          val === 1 ? lineInfo[t].metricSingular : lineInfo[t].metricPlural
        }`
        const dateParts = dateLabel.split('-')
        const dateText = `${months[dateParts[1]]} ${parseInt(dateParts[2])}, ${dateParts[0]}`
        hoverLabelVal.attr({ text: valText })
        hoverLabelDate.attr({ text: dateText })

        // Position popup
        const popupWidth =
          Math.max(hoverLabelVal.getBBox().width, hoverLabelDate.getBBox().width) + 20
        const popupHeight = 40
        frame.attr({ width: popupWidth })

        let popupX = x + 10
        let popupY = y - popupHeight - 5

        // Adjust if too close to edges
        if (popupX + popupWidth > width) popupX = x - popupWidth - 10
        if (popupX < 0) popupX = 10
        if (popupY < 0) popupY = y + 10

        // Animate popup position and text
        frame.attr({ x: popupX, y: popupY }).show()
        hoverLabelVal.attr({ x: popupX + popupWidth / 2, y: popupY + 15 }).show()
        hoverLabelDate.attr({ x: popupX + popupWidth / 2, y: popupY + 30 }).show()
      } else {
        // Hide if mouse is outside valid point range
        if (currentDot) currentDot.hide()
        popup.hide()
      }
    })

    cover.mouseout(function () {
      if (currentDot) currentDot.hide()
      popup.hide()
    })

    console.log('Line chart drawn successfully.')
  } catch (error) {
    console.error('Error drawing line chart:', error)
    $('#chart').html('<p>Error drawing chart.</p>') // Show error in chart area
  }
}

// Deprecated Function (example, remove if truly unused)
// ClickyChrome.Functions.getUrlVars = function () { ... };
