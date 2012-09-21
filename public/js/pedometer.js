$(function() {
  var map = new google.maps.Map(document.getElementById("map_canvas"), {
    center: new google.maps.LatLng(0, 0),
    zoom: 2,
    mapTypeId: google.maps.MapTypeId.ROADMAP
  });
});