var ped = {

  DEFAULT_CENTER: new google.maps.LatLng(37.4419, -122.1419), // Palo Alto :3
  RED: "ff776b",
  WHITE: "ffffff",
  R: 6371 * 1000, // Earth radius in m

  IMPERIAL: {
    utype: 0,
    usystem: "Imperial",
    unit: "ft",
    bigUnit: "mi",
    mPerUnit: 0.3048,
    mPerBigUnit: 1609.34
  },

  METRIC: {
    utype: 1,
    usystem: "Metric",
    unit: "m",
    bigUnit: "km",
    mPerUnit: 1,
    mPerBigUnit: 1000
  },

  settings: {
    travelMode: google.maps.TravelMode.RUNNING,
    unitSystem: google.maps.UnitSystem.METRIC,
    dataThreshold: 3000, // Max number of elevation points to plot
    showMileMarkers: false,
  },

  map: null,
  directions: new google.maps.DirectionsService(),
  elevations: new google.maps.ElevationService(),
  elevationChart: null,
  elevationTooltip: null,
  sviewTooltip: null,
  path: [],
  pathsToLoad: [],

  initialize: function(center) {
    ped.setMetricSystem(ped.IMPERIAL.utype);
    ped.toggleTravelMode();

    ped.map = new google.maps.Map(document.getElementById("map_canvas"), {
      center: center,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      draggableCursor: "crosshair",
      scaleControl: "true",
      zoom: 13
    });

    ped.elevationTooltip = new google.maps.Marker({
      visible: false,
      map: ped.map
    });

    ped.sview = new google.maps.Marker({
      visible: false,
      map: ped.map
    });

    google.maps.event.addListener(ped.map, "rightclick", function(event) {
      ped.pushPathElem(event, true);
    });

    ped.registerEventHandlers();
  },

  registerEventHandlers: function() {
    $(".clickable").hover(
      function() { $(this).css("border", "solid 2px black") },
      function() { $(this).css("border", "solid 1px black") }
    );

    $("#travel_mode").click(ped.toggleTravelMode);
    $("#usystem").click(function() { ped.setMetricSystem(1 - ped.settings.utype) });
    $("#markers").click(function() { ped.toggleMileMarkers(ped.settings.showMileMarkers) });
    $("#undo").click(function() { ped.popPathElem(true); });
    $("#clear").click(ped.clear);

    $("#save").click(function() {
      if ($("#persist").is(":visible")) {
        $("#persist").hide("fast");
      } else {
        $("#persist").show("fast");
        $("#persist_input").attr("value", ped.encodePath()).select();
      };
    });

    $("#load").click(function() {
      if ($("#persist").is(":visible")) {
        $("#persist").hide("fast");
        ped.loadPath($("#persist_input").attr("value"));
      } else {
        $("#persist").show("fast");
        $("#persist_input").attr("value", "").select();
      };
    });

    $("#sview_button").click(function() {
      $("#sview").toggle("fast");
    });

    $("#help_button").click(function() {
      $("#help").toggle("fast");
    });

    $("#elevation").mouseout(function() { ped.renderElevationTooltip(null); });
  },


  loadPath: function(data) {
    if (data === "") return;
    ped.pathsToLoad = ped.decodePath(data);
    ped.clear();
    ped.loadNextPathElem();
  },

  loadNextPathElem: function() {
    path = ped.pathsToLoad.shift();
    if (!path) return;
    ped.pushPathElem(path);
  },

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

        ped.renderPathElemInfo(pathElem);
        // If loading a path, only render the elevation on the last element
        if (ped.pathsToLoad.length > 0) {
          ped.loadNextPathElem();
        } else {
          ped.renderElevation();
        }
      };
    });
  },

  computePathMileMarkers: function(pathElem) {
    var distance = pathElem.totalDistance - pathElem.distance;
    var nextMileToRender = Math.floor(distance / ped.settings.mPerBigUnit) + 1;

    $.each(pathElem.edge.overview_path.slice(1), function(index, position) {
      var estimate = ped.haversineDistAndBearing(position, pathElem.edge.overview_path[index]);
      pathElem.haversineDistances.push(estimate.distance);
      pathElem.bearings.push(estimate.bearing);
    });

    var haversineSum = pathElem.haversineDistances.reduce(function(sum, distance) {
      return sum + distance;
    }, 0);

    $.each(pathElem.edge.overview_path.slice(1), function(index, position) {
      distance += pathElem.haversineDistances[index] / haversineSum  * pathElem.distance;
      if (distance > nextMileToRender * ped.settings.mPerBigUnit) {
        var marker = ped.renderNumberedMarker(
          nextMileToRender, position, ped.WHITE, ped.settings.showMileMarkers, -1);
        pathElem.mileMarkers.push(marker);
        nextMileToRender += 1;
      }
    });

    ped.computePathElevation(pathElem);
  },

  // Asynchronously query the DirectionsRoute to the pathElem's node and draw them
  computePathEdge: function(pathElem) {
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
        ped.renderDirections(pathElem, response);

        $.each(response.routes[0].legs, function(index, leg) {
          pathElem.distance += leg.distance.value;
        });
        pathElem.totalDistance = prevElem.totalDistance + pathElem.distance;
        ped.renderDistance(pathElem.totalDistance);

        ped.computePathMileMarkers(pathElem);
      };
    });
  },

  pushPathElem: function(event) {
    var pathElem = {
      node: ped.renderNumberedMarker(
        ped.path.length + 1, event.latLng, ped.RED, true, 0),
      infoWindow: null,

      edge: null,
      haversineDistances: [],
      bearings: [],
      elevations: [],
      mileMarkers: [],

      renderer: null,

      distance: 0,
      totalDistance: 0,
      climb: 0,
      grade: 0
    }

    if (ped.path.length > 0) ped.computePathEdge(pathElem);
    ped.path.push(pathElem);

    // When reloading a path, the first node won't trigger the asynchronous callback
    // because it has no path data to load. Instead trigger it manually here.
    if (ped.pathsToLoad.length > 0 && ped.path.length === 1) ped.loadNextPathElem();
  },

  popPathElem: function(rerender) {
    if (ped.path.length === 0) return;
    var pathElem = ped.path.pop();

    pathElem.node.setVisible(false);
    $.each(pathElem.mileMarkers, function(index, marker) {
      marker.setVisible(false);
    });
    if (pathElem.renderer) pathElem.renderer.setMap(null);

    if(rerender) {
      ped.renderDistance(pathElem.totalDistance - pathElem.distance);
      ped.renderElevation();
    };
  },

  clear: function() {
    ped.renderDistance(0);
    if (ped.elevationChart) ped.elevationChart.destroy();
    ped.elevationChart = null;
    while (ped.path.length > 0) {
      ped.popPathElem(false);
    }
  },

  toggleMileMarkers: function(showing) {
    ped.settings.showMileMarkers = !showing;
    $.each(ped.path, function(index, pathElem) {
      $.each(pathElem.mileMarkers, function(index, marker) {
        marker.setVisible(ped.settings.showMileMarkers);
      });
    });
  },

  setMetricSystem: function(utype) {
    if (ped.settings.utype === utype) return;

    var system = (utype === ped.IMPERIAL.utype) ? ped.IMPERIAL : ped.METRIC;
    for (var attr in system) { ped.settings[attr] = system[attr]; }

    $("#markers").html(ped.settings.bigUnit + " Marks");
    $("#distance").html("0" + ped.settings.bigUnit);
    $("#usystem").html(ped.settings.usystem);

    ped.loadPath(ped.encodePath());
  },

  toggleTravelMode: function() {
    if (ped.settings.travelMode === google.maps.TravelMode.BICYCLING) {
      ped.settings.travelMode = google.maps.TravelMode.WALKING
      $("#travel_mode").html("Running");
    } else {
      ped.settings.travelMode = google.maps.TravelMode.BICYCLING
      $("#travel_mode").html("Biking");
    };
  },


  // Rendering

  renderDirections: function(pathElem, response) {
    if (pathElem.renderer === null) {
      pathElem.renderer = new google.maps.DirectionsRenderer({
        suppressBicyclingLayer: true,
        preserveViewport: true,
        map: ped.map,
        markerOptions: {
          visible: false,
        }
      });
    };

    pathElem.renderer.setDirections(response);
  },

  renderNumberedMarker: function(number, position, color, show, zIndex) {
    return new google.maps.Marker({
      visible: show,
      position: position,
      map: ped.map,
      zIndex: zIndex,
      icon: "http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld=" +
        Math.round(number) + "|" + color
    });
  },

  renderPathElemInfo: function(pathElem) {
    pathElem.infoWindow = new google.maps.InfoWindow({
      content : "<div class='info-window'>" +
        "</br>Distance: " + ped.convertBig(pathElem.distance) + ped.settings.bigUnit +
        "</br>Total: " + ped.convertBig(pathElem.totalDistance) + ped.settings.bigUnit +
        "</br>Climb: " + ped.convert(pathElem.climb) + ped.settings.unit +
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
    $("#distance").html(ped.convertBig(distance) + ped.settings.bigUnit);
  },

  renderElevationTooltip: function(position) {
    if (position === null) {
      ped.elevationTooltip.setVisible(false);
      return;
    };

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
            return ped.convert(this.value) + ped.settings.unit;
          }
        }
      },
      xAxis: {
        tickInterval: 0,
        title: { text: "Distance" },
      },
      tooltip: {
        formatter: function() {
          return ped.convertBig(this.x) +  ped.settings.bigUnit +
            " | " + ped.convert(this.y) + ped.settings.unit;
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

  convert: function(m) {
    return Math.round(m / ped.settings.mPerUnit);
  },

  convertBig: function(m) {
    return Math.round(m / ped.settings.mPerBigUnit * 100) / 100;
  },

  encodePath: function() {
    var path = ped.path.map(function(pathElem, index) {
      var latLng = pathElem.node.getPosition();
      return [latLng.Xa, latLng.Ya];
    });
    return lzwEncode(Base64.encode(JSON.stringify(path)));
  },

  // Returns fake events to pass into pushPathElem
  decodePath: function(data) {
    var path = JSON.parse(Base64.decode(lzwDecode(data)));
    return path.map(function(pathElem, index) {
      return { latLng: new google.maps.LatLng(pathElem[0], pathElem[1]) };
    });
  },

  // http://www.movable-type.co.uk/scripts/latlong.html
  haversineDistAndBearing: function(p1, p2) {
    var dLat = ped.toRad(p2.lat() - p1.lat());
    var dLng = ped.toRad(p2.lng() - p1.lng());
    var lat1 = ped.toRad(p1.lat());
    var lat2 = ped.toRad(p2.lat());

    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLng/2) * Math.sin(dLng/2) * Math.cos(lat1) * Math.cos(lat2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var distance = ped.R * c;

    var y = Math.sin(dLng) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    var bearing = ped.toDeg(Math.atan2(y, x));

    return {
      distance: distance,
      bearing: bearing
    }
  },

  toRad: function(number) {
    return number * Math.PI / 180
  },

  toDeg: function(number) {
    return number * 180 / Math.PI
  }

}

$(function() {
  if(navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function(position) {
      ped.initialize(new google.maps.LatLng(position.coords.latitude,position.coords.longitude));
    }, function() {
      ped.initialize(ped.DEFAULT_CENTER);
    });
  } else {
    ped.initialize(ped.DEFAULT_CENTER);
  };
});