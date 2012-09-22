var ped = {

  settings: {
    travelMode: google.maps.TravelMode.BICYCLING,
    unitSystem: google.maps.UnitSystem.METRIC,
    dataThreshold: 3000, // elevation points
  },

  map: null,
  directions: new google.maps.DirectionsService(),
  elevations: new google.maps.ElevationService(),
  elevationChart: null,
  elevationTooltip: null,
  path: [],

  initialize: function() {
    ped.map = new google.maps.Map(document.getElementById("map_canvas"), {
      center: new google.maps.LatLng(37.4419, -122.1419),
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      draggableCursor: "crosshair",
      zoom: 13
    });

    ped.elevationTooltip = new google.maps.Marker({
      visible: false,
      map: ped.map
    }),

    google.maps.event.addListener(ped.map, "rightclick", function(event) { ped.pushPathNode(event); });
    $("#undo").click(function() { ped.popPathNode(true); });
    $("#clear").click(ped.clear);
    $("#undo, #clear").hover(
      function() { $(this).css("border", "solid 2px black") },
      function() { $(this).css("border", "solid 1px black") }
    );
    $("#elevation").mouseout(function() { ped.renderElevationTooltip(null); });
  },

  // Heavy lifting

  // Asynchronously query the elevations along the DirectionsRoute
  computePathElevation: function(pathElem) {
    var request = {
      locations: pathElem.edge.overview_path
    };

    ped.elevations.getElevationForLocations(request, function(response, status) {
      if (status === google.maps.ElevationStatus.OK) {
        pathElem.elevations = response;
        pathElem.climb = response.slice(-1)[0].elevation - response[0].elevation;
        pathElem.grade = pathElem.climb / pathElem.distance;

        ped.renderPathNodeInfo(pathElem);
        ped.renderElevation();
      };
    });
  },

  // Asynchronously query the DirectionsRoute to the pathElem's node and draw them
  computePathEdge: function(pathElem) {
    if (ped.path.length === 0) return null;
    var prevElem = ped.path.slice(-1)[0];

    var request = {
      origin: prevElem.node.position,
      destination: pathElem.node.position,
      travelMode: ped.settings.travelMode,
      unitSystem: ped.settings.unitSystem
    };

    ped.directions.route(request, function(response, status) {
      if (status === google.maps.DirectionsStatus.OK) {
        pathElem.edge = response.routes[0];
        pathElem.renderer.setDirections(response);

        $.each(response.routes[0].legs, function(index, leg) {
          pathElem.distance += leg.distance.value;
        });
        pathElem.totalDistance = prevElem.totalDistance + pathElem.distance;
        ped.renderDistance(pathElem.totalDistance);

        ped.computePathElevation(pathElem);
      };
    });
  },

  pushPathNode: function(event) {
    var pathElem = {
      index: ped.path.length,

      node: new google.maps.Marker({ 
        position: event.latLng,
        map: ped.map,
      }),
      infoWindow: null,

      edge: null,
      elevations: [],

      renderer: new google.maps.DirectionsRenderer({
        suppressBicyclingLayer: true,
        preserveViewport: true,
        map: ped.map,
        markerOptions: {
          visible: false,
        }
      }),

      distance: 0,
      totalDistance: 0,
      climb: 0,
      grade: 0
    }

    ped.computePathEdge(pathElem);
    ped.path.push(pathElem);
  },

  popPathNode: function(rerender) {
    if (ped.path.length === 0) return;
    var pathElem = ped.path.pop();

    pathElem.node.setVisible(false);
    pathElem.renderer.setMap(null);

    if(rerender) {
      ped.renderDistance(pathElem.totalDistance - pathElem.distance);
      ped.renderElevation();
    };
  },

  clear: function() {
    if (ped.elevationChart) ped.elevationChart.destroy();
    ped.elevationChart = null;
    while (ped.path.length > 0) {
      ped.popPathNode(false);
    }
  },


  // Rendering

  renderPathNodeInfo: function(pathElem) {
    pathElem.infoWindow = new google.maps.InfoWindow({
      content : "<div class='info-window'>" +
        "</br>Distance: " + ped.mToKm(pathElem.distance) + " km" +
        "</br>Total: " + ped.mToKm(pathElem.totalDistance) + " km" +
        "</br>Climb: " + Math.round(pathElem.climb) + " m" +
        "</br>Grade: " + Math.round(pathElem.grade * 1000) / 10 + "%" +
        "</div>",
      disableAutoPan: true,
    });

    google.maps.event.addListener(pathElem.node, "mouseover", function() {
      pathElem.infoWindow.open(ped.map, pathElem.node);
    });

    google.maps.event.addListener(pathElem.node, "mouseout", function() {
      pathElem.infoWindow.close();
    });

  },

  renderDistance: function(distance) {
    $("#distance").html(ped.mToKm(distance) + " km");
  },

  renderElevationTooltip: function(position) {
    if (position === null) {
      ped.elevationTooltip.setVisible(false);
      return;
    }

    ped.elevationTooltip.setVisible(true);
    ped.elevationTooltip.setPosition(position);
  },

  renderElevation: function() {
    var highChartsData = ped.path.reduce(function(highChartsData, pathElem) {
      startDistance = pathElem.totalDistance - pathElem.distance;
      step = pathElem.distance / pathElem.elevations.length;

      return highChartsData.concat(pathElem.elevations.map(function(point, index) {
        return {
          x: startDistance + step * index,
          y: point.elevation,
          events: {
            mouseOver: function() { ped.renderElevationTooltip(point.location); }
          }
        };
      }));

    }, []);

    if (ped.elevationChart) ped.elevationChart.destroy();
    if (highChartsData.length > ped.settings.dataThreshold) {
      $("#elevation").html("Path too long to graph");
      return;
    };

    ped.elevationChart = new Highcharts.Chart({
      chart: {
        renderTo: "elevation",
        type: "area",
      },
      title: {
        text: "",
      },
      yAxis: {
        title: { text: "Height" },
        labels: {
          formatter: function() {
            return this.value + "m";
          }
        }
      },
      xAxis: {
        tickInterval: 0,
        title: { text: "Distance" },
      },
      tooltip: {
        formatter: function() {
          return ped.mToKm(this.x) + "km | " + Math.round(this.y) + "m";
        }
      },
      plotOptions: {
        area: {
          lineWidth: 1,
          marker: {
            enabled: false,
          },
        },
        series: {
          turboThreshold: ped.settings.dataThreshold
        }
      },
      legend: {
        enabled: false
      },
      series: [{
        name: "Elevation",
        data: highChartsData
      }]
    });
  },

  // Utility

  mToKm: function(m) {
    return Math.round(m / 10) / 100;
  }

}

$(function() {
  ped.initialize();
})