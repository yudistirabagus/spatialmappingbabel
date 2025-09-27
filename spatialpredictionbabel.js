// ===========================
// 1. Impor dataset prediksi
// ===========================
var table = ee.FeatureCollection('projects/ee-ydsbgsp/assets/forecast_to_2030_grid');

// ===========================
// 2. Daftar tahun (2025–2030)
// ===========================
var years = [2025, 2026, 2027, 2028, 2029, 2030];

// ===========================
// 3. Batas Administratif Bangka Belitung
// ===========================
var adm2 = ee.FeatureCollection('FAO/GAUL/2015/level2')
  .filter(ee.Filter.eq('ADM0_NAME', 'Indonesia'))
  .filter(ee.Filter.stringContains('ADM1_NAME', 'Bangka'));
Map.centerObject(adm2, 8);

// ===========================
// 4. Buat dictionary layer per tahun
// ===========================
var yearlyData = {};
years.forEach(function(year) {
  var dataYear = table.filter(ee.Filter.stringContains('date', year.toString()));

  var imageYear = dataYear.reduceToImage({
    properties: ['predicted'],
    reducer: ee.Reducer.sum() // Jumlahkan semua bulan dalam tahun tersebut
  }).unmask(0).multiply(1000);

  yearlyData[year] = imageYear;
});

// ===========================
// 5. UI Dropdown untuk pilih tahun
// ===========================
var selector = ui.Select({
  items: years.map(String),
  value: '2025',
  onChange: updateMap
});
var panel = ui.Panel({widgets: [ui.Label('Pilih Tahun:'), selector]});
ui.root.insert(0, panel);

// ===========================
// 6. Fungsi Update Map & Legend
// ===========================
var currentLayer;
function updateMap(yearStr) {
  var year = parseInt(yearStr);
  if (currentLayer) Map.layers().remove(currentLayer);

  var img = yearlyData[year];
  currentLayer = ui.Map.Layer(img, {min: 0, max: 500, palette: ['white', 'yellow', 'orange', 'red']}, 'Prediksi ' + year);
  Map.layers().add(currentLayer);

  // Hitung zonal stats per kabupaten
  var zonal = img.reduceRegions({
    collection: adm2,
    reducer: ee.Reducer.sum(),
    scale: 250,
    tileScale: 4,
    maxPixelsPerRegion: 1e13
  });

  // Tentukan kategori choropleth
  var maxVal = ee.Number(zonal.aggregate_max('sum'));
  var low = maxVal.divide(3);
  var mid = maxVal.divide(3).multiply(2);

  var categorized = zonal.map(function(f) {
    var val = ee.Number(f.get('sum'));
    var color = ee.String(
      ee.Algorithms.If(val.lte(low), 'yellow',
        ee.Algorithms.If(val.lte(mid), 'orange', 'red')
      )
    );
    return f.set('style', {color: color, fillColor: color, width: 1});
  });

  Map.addLayer(categorized.style({styleProperty: 'style'}), {}, 'Choropleth ' + year);

  // Update legend kategori
  addLegendCategories(low, mid);

  // Update panel info kabupaten
  updatePanel(zonal);

  // Update grafik
  updateChart(zonal, year);
}

// ===========================
// 7. Fungsi Legend Kategori
// ===========================
function addLegendCategories(low, mid) {
  var existing = ui.root.widgets().filter(function(w) {
    return w instanceof ui.Panel && w.style().get('position') === 'bottom-left';
  });
  if (existing.length > 0) ui.root.remove(existing[0]);

  var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px'}});
  legend.add(ui.Label('Kategori Hotspot', {fontWeight: 'bold', fontSize: '14px'}));

  var categories = [
    {color: 'yellow', label: 'Rendah (≤ ' + low.format('%.0f').getInfo() + ')'},
    {color: 'orange', label: 'Sedang (≤ ' + mid.format('%.0f').getInfo() + ')'},
    {color: 'red', label: 'Tinggi (> ' + mid.format('%.0f').getInfo() + ')'}
  ];

  categories.forEach(function(cat) {
    var row = ui.Panel({
      widgets: [
        ui.Label({style: {backgroundColor: cat.color, padding: '8px', margin: '0'}}),
        ui.Label(cat.label, {margin: '4px 0 4px 6px'})
      ],
      layout: ui.Panel.Layout.flow('horizontal')
    });
    legend.add(row);
  });

  ui.root.add(legend);
}

// ===========================
// 8. Panel info kabupaten
// ===========================
function updatePanel(zonal) {
  zonal.aggregate_array('ADM2_NAME').zip(zonal.aggregate_array('sum')).evaluate(function(list) {
    var existingPanels = ui.root.widgets().filter(function(w) {
      return w instanceof ui.Panel && w.style().get('position') === 'top-right';
    });
    if (existingPanels.length > 0) ui.root.remove(existingPanels[0]);

    var infoPanel = ui.Panel({style: {position: 'top-right', padding: '8px'}});
    infoPanel.add(ui.Label('Total Hotspot per Kabupaten', {fontWeight: 'bold', fontSize: '14px'}));
    list.forEach(function(pair) {
      infoPanel.add(ui.Label(pair[0] + ': ' + ee.Number(pair[1]).format('%.0f').getInfo()));
    });
    ui.root.add(infoPanel);
  });
}

// ===========================
// 9. Update grafik
// ===========================
function updateChart(zonal, year) {
  var chart = ui.Chart.feature.byFeature(zonal, 'ADM2_NAME', ['sum'])
    .setChartType('ColumnChart')
    .setOptions({
      title: 'Total Hotspot Prediksi per Kabupaten/Kota (' + year + ')',
      hAxis: {title: 'Kabupaten/Kota', slantedText: true, slantedTextAngle: 45},
      vAxis: {title: 'Jumlah Hotspot'},
      colors: ['#FF8C00']
    });
  print(chart);
}

// Jalankan default tahun pertama
updateMap('2025');
