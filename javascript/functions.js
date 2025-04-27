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
ClickyChrome.Const = {
  URL_APP_PARAM: 'clickychrome_mv3',
}

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

/**
 * Draws browser pie chart using Raphael JS library
 *
 * @param {array} d
 *    Data array
 * @param {array} l
 *    Label array
 * @param {array} u
 *    URL array
 */
ClickyChrome.Functions.drawPie = function (d, l, u) {
  var r = Raphael('chart')
  var colors2 = [
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
  for (var i = 0; i < l.length; i++) {
    l[i] = '%%: ' + l[i]
  }
  var pie = r.g.piechart(315, 100, 65, d, {
    legend: l,
    legendpos: 'west',
    colors: colors2,
    href: u,
  })
  pie.hover(
    function () {
      this.sector.stop()
      this.sector.scale(1.1, 1.1, this.cx, this.cy)
      if (this.label) {
        this.label[0].stop()
        this.label[0].scale(1)
        this.label[1].attr({ 'font-weight': 600 })
      }
    },
    function () {
      this.sector.animate({ scale: [1, 1, this.cx, this.cy] }, 500, 'bounce')
      if (this.label) {
        this.label[0].animate({ scale: 1 }, 500, 'bounce')
        this.label[1].attr({ 'font-weight': 400 })
      }
    }
  )
}

/**
 * Draws charts for visitors and actions using Raphael JS library
 *
 * @param {array} d
 *    Data array
 *  @param {array} l
 *    Label array
 *  @param {array} t
 *    Type of chart, visitors or actions
 */
ClickyChrome.Functions.drawChart = function (d, l, t) {
  // Metric name
  var lineInfo = {
      visitors: {
        metricSingular: 'Visitor',
        metricPlural: 'Visitors',
        mainColor: '#5D93E1',
      },
      actions: {
        metricSingular: 'Action',
        metricPlural: 'Actions',
        mainColor: '#F80',
      },
    },
    months = {
      '01': 'January',
      '02': 'February',
      '03': 'March',
      '04': 'April',
      '05': 'May',
      '06': 'June',
      '07': 'July',
      '08': 'August',
      '09': 'September',
      10: 'October',
      11: 'November',
      12: 'December',
    },
    data = d.split(','),
    labels = l.split(','),
    // # of horizontal sections in graph
    hSplit = 5,
    // # of vertical sections in graph
    vSplit = 4,
    // Grid details
    gridColor = '#aaa',
    gridWidth = '.2',
    showVertGrid = false,
    showVertTicks = true,
    showHorizGrid = true,
    showHorizTicks = true,
    // Graph borders
    bottomGutter = 20,
    topGutter = 20,
    // Graph line styling
    lineWidth = 3,
    lineColor = lineInfo[t].mainColor,
    // Data point styling
    pointRadius = 0,
    pointFill = lineInfo[t].mainColor,
    pointStroke = 'none',
    pointStrokeWidth = 0,
    pointHoverRadius = 5,
    pointHoverFill = lineInfo[t].mainColor,
    pointHoverStroke = 'none',
    pointHoverStrokeWidth = 0,
    // Graph fill?
    showFill = true,
    fillOpacity = '.2',
    // Text stylings
    txtData = { font: '10px Fontin-Sans, Arial', fill: '#000', 'text-anchor': 'end' },
    txtLabels = { font: '12px Fontin-Sans, Arial', fill: '#000', 'text-anchor': 'start' },
    txtHoverData = { font: 'bold 12px Fontin-Sans, Arial', fill: '#000' },
    txtHoverLabels = { font: '10px Fontin-Sans, Arial', fill: '#000' },
    // Popup styling
    hoverStrokeWidth = 3,
    hoverStrokeColor = '#aaa',
    hoverFillColor = '#eee',
    leftGutter,
    i,
    max = Math.max.apply(Math, data)
  // Width of gutter depends on length of max data point
  var maxP = max.toString().length
  switch (maxP) {
    case 7:
      leftGutter = 55
      break
    case 6:
      leftGutter = 45
      break
    case 5:
      leftGutter = 40
      break
    case 4:
      leftGutter = 35
      break
    case 3:
      leftGutter = 25
      break
    case 2:
      leftGutter = 20
      break
    case 1:
      leftGutter = 15
      break
    default:
      leftGutter = 40
  }
  // Height of graph
  var height = 188
  // Width of graph
  var width = 385

  // Increment measurements
  var X = (width - leftGutter) / labels.length
  var Y = (height - bottomGutter - topGutter) / max

  // Initialize this mofo
  var r = Raphael('chart', width, height)
  // Put data oldest->newest
  data.reverse()
  labels.reverse()

  // Setup and draw y-axis labels
  var rH = (height - topGutter - bottomGutter) / vSplit,
    vT = topGutter,
    vI = Math.ceil(max / vSplit),
    vL = max
  for (i = 0; i <= vSplit; i++) {
    if (i == vSplit) vL = '0'
    r.text(leftGutter - 4, vT, this.addCommas(vL)).attr(txtData)
    vT += rH
    vL -= vI
  }

  // Start drawing!
  var path = r
      .path()
      .attr({ stroke: lineColor, 'stroke-width': lineWidth, 'stroke-linejoin': 'round' }),
    frame = r
      .rect(10, 10, 200, 40, 5)
      .attr({ fill: hoverFillColor, stroke: hoverStrokeColor, 'stroke-width': hoverStrokeWidth })
      .hide(),
    is_label_visible = false,
    leave_timer,
    blanket = r.set(),
    label = []
  // Placeholders
  label[0] = r.text(60, 10, '').attr(txtHoverData).hide()
  label[1] = r.text(60, 40, '').attr(txtHoverLabels).hide()

  if (showFill)
    var bgp = r
      .path()
      .attr({ stroke: 'none', opacity: fillOpacity, fill: lineColor })
      .moveTo(leftGutter + X * 0.5, height - bottomGutter)

  // Loop through data and draw graph
  var divPoints = []
  for (i = 0, ii = labels.length; i < ii; i++) {
    var labelDate = labels[i].split('-'),
      labelDay = labelDate[2].charAt(0) == '0' ? labelDate[2].substring(1) : labelDate[2],
      thisAbvDate = months[labelDate[1]].substring(0, 3) + ' ' + labelDay,
      y = Math.floor(height - bottomGutter - Y * data[i]),
      x = Math.floor(leftGutter + X * (i + 0.5)),
      stop = Math.floor(ii / hSplit)

    // X-axis labels for each horizontal section
    if (i % stop == 0 && i < ii - 1) {
      r.text(x, height - 6, thisAbvDate)
        .attr(txtLabels)
        .toBack()
      divPoints.push(x)
    }
    // Draw path
    if (showFill) bgp[i == 0 ? 'lineTo' : 'lineTo'](x, y, 10)
    path[i == 0 ? 'moveTo' : 'lineTo'](x, y, 10)
    var dot = r.circle(x, y, 0)
    blanket.push(
      r
        .rect(leftGutter + X * i, topGutter - pointHoverRadius, X, height - bottomGutter)
        .attr({ stroke: 'none', fill: '#fff', opacity: 0 })
    )
    var rect = blanket[blanket.length - 1]

    ;(function (x, y, data, lbl, dot) {
      $(rect.node).hover(
        function () {
          clearTimeout(leave_timer)
          // Hover date
          var hoverDate = lbl.split('-')
          var hoverDay = hoverDate[2].charAt(0) == '0' ? hoverDate[2].substring(1) : hoverDate[2]
          var thisDate = months[hoverDate[1]].substring(0, 3) + ' ' + hoverDay + ', ' + hoverDate[0]

          // Hover styling and positioning
          label[0].attr({
            text:
              ClickyChrome.Functions.addCommas(data) +
              ' ' +
              (data == 1 ? lineInfo[t].metricSingular : lineInfo[t].metricPlural),
          })
          label[1].attr({ text: thisDate })

          var l0w = label[0].getBBox().width,
            l1w = label[1].getBBox().width,
            thisHoverW = l0w > l1w ? l0w + 20 : l1w + 20

          // Hover coordinates and adjustments to keep within graph
          var newcoord = { x: x + 10, y: y - 10 }
          if (newcoord.x + (thisHoverW + 20) > width) newcoord.x -= thisHoverW + 20
          if (newcoord.y + 50 > height - bottomGutter) newcoord.y = height - bottomGutter - 50
          if (newcoord.y - topGutter < 10) newcoord.y = topGutter + 10

          frame
            .attr({ width: thisHoverW })
            .animate({ x: newcoord.x, y: newcoord.y }, 100 * is_label_visible)
            .show()
          label[0]
            .show()
            .animateWith(
              frame,
              { x: +newcoord.x + thisHoverW / 2, y: +newcoord.y + 14 },
              100 * is_label_visible
            )
          label[1]
            .show()
            .animateWith(
              frame,
              { x: +newcoord.x + thisHoverW / 2, y: +newcoord.y + 28 },
              100 * is_label_visible
            )
          dot.attr({
            r: pointHoverRadius,
            fill: pointHoverFill,
            stroke: pointHoverStroke,
            'stroke-width': pointHoverStrokeWidth,
          })
          is_label_visible = true
        },
        function () {
          dot.attr({
            r: pointRadius,
            fill: pointFill,
            stroke: pointStroke,
            'stroke-width': pointStrokeWidth,
          })
          leave_timer = setTimeout(function () {
            frame.hide()
            label[0].hide()
            label[1].hide()
            is_label_visible = false
          }, 1)
        }
      )
    })(x, y, data[i], labels[i], dot)
  }
  // Finish it up
  if (showFill) bgp.lineTo(x, height - bottomGutter).andClose()
  frame.toFront()
  label[0].toFront()
  label[1].toFront()
  blanket.toFront()
  // Draw grid
  r.drawGrid(
    'grid',
    leftGutter + X * 0.5,
    topGutter,
    width - leftGutter - X,
    height - topGutter - bottomGutter,
    hSplit,
    vSplit,
    gridColor,
    gridWidth,
    showVertGrid,
    showHorizGrid,
    showVertTicks,
    showHorizTicks,
    divPoints.join(',')
  ).toBack()
  r.drawGrid(
    'ticks',
    leftGutter + X * 0.5,
    topGutter,
    width - leftGutter - X,
    height - topGutter - bottomGutter,
    hSplit,
    vSplit,
    gridColor,
    gridWidth,
    showVertGrid,
    showHorizGrid,
    showVertTicks,
    showHorizTicks,
    divPoints.join(',')
  ).toBack()
  // Add data legend
  r.path(
    'M' + (leftGutter + 10) + ',' + topGutter / 2 + 'L' + (leftGutter + 20) + ',' + topGutter / 2
  ).attr({ stroke: lineColor, 'stroke-width': lineWidth })
  r.text(leftGutter + 25, topGutter / 2, lineInfo[t].metricPlural).attr(txtLabels)
}
