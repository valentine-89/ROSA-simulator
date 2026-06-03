const DASHBOARD_MARKERS = {
  layoutStart: '<!-- AI-BRIDGE-EDITABLE HTML LAYOUT: START -->',
  layoutEnd: '<!-- AI-BRIDGE-EDITABLE HTML LAYOUT: END -->',
  configStart: '<!-- AI-BRIDGE-EDITABLE DASHBOARD CONFIG: START -->',
  configEnd: '<!-- AI-BRIDGE-EDITABLE DASHBOARD CONFIG: END -->',
  sampleScriptStart: '<!-- AI-BRIDGE-EDITABLE SAMPLE SCRIPT: START -->',
  sampleScriptEnd: '<!-- AI-BRIDGE-EDITABLE SAMPLE SCRIPT: END -->',
  runtimeStart: '<!-- AI-BRIDGE-LOCKED RUNTIME SCRIPT: START -->',
  runtimeEnd: '<!-- AI-BRIDGE-LOCKED RUNTIME SCRIPT: END -->'
};

const REQUIRED_CORE_MARKERS = [
  DASHBOARD_MARKERS.layoutStart,
  DASHBOARD_MARKERS.layoutEnd,
  DASHBOARD_MARKERS.configStart,
  DASHBOARD_MARKERS.configEnd,
  DASHBOARD_MARKERS.runtimeStart,
  DASHBOARD_MARKERS.runtimeEnd
];

const OPTIONAL_SAMPLE_SCRIPT_MARKERS = [
  DASHBOARD_MARKERS.sampleScriptStart,
  DASHBOARD_MARKERS.sampleScriptEnd
];

function trimConfigJson(content) {
  return String(content || '').trim();
}

function findBlockRange(html, startMarker, endMarker, fromIndex) {
  const markerStart = html.indexOf(startMarker, fromIndex);
  if (markerStart < 0) return null;
  const contentStart = markerStart + startMarker.length;
  const contentEnd = html.indexOf(endMarker, contentStart);
  if (contentEnd < 0) return null;
  return { markerStart, contentStart, contentEnd, markerEnd: contentEnd + endMarker.length };
}

function splitJsonScriptConfigBlock(content) {
  const source = String(content || '');
  const match = source.match(/^(\s*<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>)([\s\S]*?)(<\/script>\s*)$/i);
  if (!match) return { json: trimConfigJson(source), wrapper: null };
  return {
    json: trimConfigJson(match[2]),
    wrapper: { prefix: match[1], suffix: match[3] }
  };
}

function dashboardHtmlUsesMarkers(html) {
  const source = String(html || '');
  return [...REQUIRED_CORE_MARKERS, ...OPTIONAL_SAMPLE_SCRIPT_MARKERS].some((marker) => source.includes(marker));
}

function getMissingDashboardMarkers(html, referenceHtml = '') {
  const source = String(html || '');
  const reference = String(referenceHtml || '');
  const missing = REQUIRED_CORE_MARKERS.filter((marker) => !source.includes(marker));
  const sampleScriptUsed = OPTIONAL_SAMPLE_SCRIPT_MARKERS.some((marker) => source.includes(marker) || reference.includes(marker));
  if (sampleScriptUsed) {
    missing.push(...OPTIONAL_SAMPLE_SCRIPT_MARKERS.filter((marker) => !source.includes(marker)));
  }
  return missing;
}

function getReservedDashboardMarkersInContent(content) {
  const source = String(content || '');
  return [...REQUIRED_CORE_MARKERS, ...OPTIONAL_SAMPLE_SCRIPT_MARKERS].filter((marker) => source.includes(marker));
}

function parseDashboardEditableSections(html) {
  const sourceHtml = String(html || '');
  const defaultSections = { layout: '', config: '', sampleScript: '' };
  if (!dashboardHtmlUsesMarkers(sourceHtml)) {
    return {
      hasMarkers: false,
      hasSampleScript: false,
      parseError: '',
      sourceHtml,
      sections: defaultSections,
      ranges: null,
      configWrapper: null
    };
  }

  const missing = getMissingDashboardMarkers(sourceHtml, sourceHtml);
  if (missing.length > 0) {
    return {
      hasMarkers: false,
      hasSampleScript: false,
      parseError: 'missing_markers',
      sourceHtml,
      sections: defaultSections,
      ranges: null,
      configWrapper: null
    };
  }

  const layoutRange = findBlockRange(sourceHtml, DASHBOARD_MARKERS.layoutStart, DASHBOARD_MARKERS.layoutEnd, 0);
  const configRange = layoutRange
    ? findBlockRange(sourceHtml, DASHBOARD_MARKERS.configStart, DASHBOARD_MARKERS.configEnd, layoutRange.markerEnd)
    : null;
  const runtimeRange = configRange
    ? findBlockRange(sourceHtml, DASHBOARD_MARKERS.runtimeStart, DASHBOARD_MARKERS.runtimeEnd, configRange.markerEnd)
    : null;
  if (!layoutRange || !configRange || !runtimeRange) {
    return {
      hasMarkers: false,
      hasSampleScript: false,
      parseError: 'invalid_marker_order',
      sourceHtml,
      sections: defaultSections,
      ranges: null,
      configWrapper: null
    };
  }

  let sampleScriptRange = null;
  const sampleScriptStartIndex = sourceHtml.indexOf(DASHBOARD_MARKERS.sampleScriptStart, configRange.markerEnd);
  if (sampleScriptStartIndex >= 0 && sampleScriptStartIndex < runtimeRange.markerStart) {
    sampleScriptRange = findBlockRange(
      sourceHtml,
      DASHBOARD_MARKERS.sampleScriptStart,
      DASHBOARD_MARKERS.sampleScriptEnd,
      configRange.markerEnd
    );
    if (!sampleScriptRange || sampleScriptRange.markerEnd > runtimeRange.markerStart) {
      return {
        hasMarkers: false,
        hasSampleScript: false,
        parseError: 'invalid_marker_order',
        sourceHtml,
        sections: defaultSections,
        ranges: null,
        configWrapper: null
      };
    }
  }

  const configSection = splitJsonScriptConfigBlock(sourceHtml.slice(configRange.contentStart, configRange.contentEnd));
  return {
    hasMarkers: true,
    hasSampleScript: !!sampleScriptRange,
    parseError: '',
    sourceHtml,
    sections: {
      layout: sourceHtml.slice(layoutRange.contentStart, layoutRange.contentEnd),
      config: configSection.json,
      sampleScript: sampleScriptRange ? sourceHtml.slice(sampleScriptRange.contentStart, sampleScriptRange.contentEnd) : ''
    },
    ranges: {
      layout: layoutRange,
      config: configRange,
      sampleScript: sampleScriptRange,
      runtime: runtimeRange
    },
    configWrapper: configSection.wrapper
  };
}

function composeDashboardEditableSections(parsed, sections) {
  if (!parsed || !parsed.hasMarkers || !parsed.ranges) return parsed ? parsed.sourceHtml : '';
  const sourceHtml = parsed.sourceHtml;
  const nextLayout = String((sections && sections.layout) || '');
  const nextConfigJson = trimConfigJson((sections && sections.config) || '');
  const nextConfig = parsed.configWrapper
    ? `${parsed.configWrapper.prefix}\n${nextConfigJson}\n${parsed.configWrapper.suffix}`
    : `\n${nextConfigJson}\n`;
  const nextSampleScript = String((sections && sections.sampleScript) || '');
  const { layout, config, sampleScript } = parsed.ranges;
  if (sampleScript) {
    return sourceHtml.slice(0, layout.contentStart)
      + nextLayout
      + sourceHtml.slice(layout.contentEnd, config.contentStart)
      + nextConfig
      + sourceHtml.slice(config.contentEnd, sampleScript.contentStart)
      + nextSampleScript
      + sourceHtml.slice(sampleScript.contentEnd);
  }
  return sourceHtml.slice(0, layout.contentStart)
    + nextLayout
    + sourceHtml.slice(layout.contentEnd, config.contentStart)
    + nextConfig
    + sourceHtml.slice(config.contentEnd);
}

module.exports = {
  DASHBOARD_MARKERS,
  composeDashboardEditableSections,
  dashboardHtmlUsesMarkers,
  getMissingDashboardMarkers,
  getReservedDashboardMarkersInContent,
  parseDashboardEditableSections
};
