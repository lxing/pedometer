var ped = {

  settings: {
    travelMode: google.maps.TravelMode.BICYCLING,
    unitSystem: google.maps.UnitSystem.METRIC,
  },

  map: null,
  directions: new google.maps.DirectionsService(),
  path: [],
  distance: 0,

  initialize: function() {
    ped.map = new google.maps.Map(document.getElementById("map_canvas"), {
      center: new google.maps.LatLng(37.4419, -122.1419),
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      draggableCursor: "crosshair",
      zoom: 13
    });

    google.maps.event.addListener(ped.map, "rightclick", function(event) { ped.pushPathNode(event); });
    $("#undo").click(ped.popPathNode);
  },

  // Asynchronously query the directions to the pathElem's node and draw them
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
        pathElem.edge = response;
        pathElem.renderer.setDirections(response);

        $.each(response.routes[0].legs, function(index, leg) {
          pathElem.distance += leg.distance.value;
        });
        pathElem.totalDistance = prevElem.totalDistance + pathElem.distance;
        ped.renderDistance(pathElem.totalDistance);
      };
    });
  },

  pushPathNode: function(event) {
    var pathElem = {
      index: ped.path.length,
      node: new google.maps.Marker({ 
        position: event.latLng,
        map: ped.map
      }),
      edge: null,
      elevations: [],
      renderer: new google.maps.DirectionsRenderer({
        suppressBicyclingLayer: true,
        preserveViewport: true,
        map: ped.map,
        markerOptions: {
          visible: false
        }
      }),
      distance: 0,
      totalDistance: 0
    }

    ped.computePathEdge(pathElem);
    ped.path.push(pathElem);
  },

  popPathNode: function() {
    if (ped.path.length === 0) return;
    var pathElem = ped.path.pop();

    pathElem.node.setVisible(false);
    pathElem.renderer.setMap(null);
    ped.renderDistance(pathElem.totalDistance - pathElem.distance);
  },

  renderDistance: function(distance) {
    $("#distance").html(Math.round(distance / 10) / 100 + " km");
  },

}

$(function() {
  ped.initialize();
})