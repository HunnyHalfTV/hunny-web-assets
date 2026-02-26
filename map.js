/* ============================================================
   map.js — 지도 및 동선 관리 로직 (CDN 버전)
   ============================================================ */

function _makeMapBtn(date, orders) {
    if (date === '최대한 빨리' || date === '추후 연락') return '';
    var key = '_mb_' + date.replace(/-/g, '');
    if (typeof _mapBtnStore !== 'undefined') {
        _mapBtnStore[key] = {
            date: date,
            addrList: orders.map(function (o) {
                return { addr: o.address, customer: o.customerName, phone: o.phone1, model: o.modelName, qty: o.quantity };
            })
        };
    }
    return '<button class="map-btn" data-action="openMapStore" data-key="' + key + '">🗺️ 지도보기</button>';
}

function _openMapFromStore(key) {
    if (typeof _mapBtnStore === 'undefined' || !_mapBtnStore[key]) {
        alert2('지도 데이터를 찾을 수 없습니다.', 'error'); return;
    }
    openMap(_mapBtnStore[key].date, _mapBtnStore[key].addrList);
}

var _mapBusy = false;
var _moMap = null, _moOkList = [], _moMarkerOvs = [], _moInfoOvs = [];
var _moOriginMarkerOv = null, _moOriginInfoOv = null, _moOpenOv = null;
var _moRoutePolylines = [], _moRouteActive = false, _moSegInfo = [];
var _moCustomOrder = [], _moAutoOrder = [];
var _moSortMode = false, _moPanelExpanded = false;
var _moKakaoLoaded = false;
var _moDgSrc = -1, _moDgEl = null;

var _moGeoCache = {};
var _moGeoCacheOrder = [];
var _MO_GEO_CACHE_MAX = 10;

function _moGeoCacheGet(date) {
    if (!_moGeoCache.hasOwnProperty(date)) return null;
    _moGeoCacheOrder.splice(_moGeoCacheOrder.indexOf(date), 1);
    _moGeoCacheOrder.push(date);
    return _moGeoCache[date];
}

function _moGeoCacheSet(date, results) {
    if (_moGeoCache.hasOwnProperty(date)) { _moGeoCacheOrder.splice(_moGeoCacheOrder.indexOf(date), 1); }
    else if (_moGeoCacheOrder.length >= _MO_GEO_CACHE_MAX) { delete _moGeoCache[_moGeoCacheOrder.shift()]; }
    _moGeoCache[date] = results; _moGeoCacheOrder.push(date);
}

function openMap(date, addrList) {
    if (_mapBusy) return;
    var cached = _moGeoCacheGet(date);
    if (cached) {
        _$('moSubtitle').textContent = date + ' 배송 동선';
        _$('mapOv').classList.add('show');
        _moLoadKakaoThenInit(cached);
        return;
    }
    _mapBusy = true;
    var btns = document.querySelectorAll('.map-btn');
    btns.forEach(b => { b.disabled = true; b.textContent = '⏳ 변환 중...'; });
    google.script.run
        .withSuccessHandler(res => {
            _mapBusy = false;
            btns.forEach(b => { b.disabled = false; b.textContent = '🗺️ 지도보기'; });
            _moGeoCacheSet(date, res);
            _$('moSubtitle').textContent = date + ' 배송 동선';
            _$('mapOv').classList.add('show');
            _moLoadKakaoThenInit(res || []);
        })
        .withFailureHandler(() => { _mapBusy = false; btns.forEach(b => { b.disabled = false; b.textContent = '🗺️ 지도보기'; }); })
        .geocodeAddresses(addrList);
}

function closeMapOv() {
    _$('mapOv').classList.remove('show');
    document.body.style.overflow = '';
    _moRouteActive = false; _moRoutePolylines.forEach(l => l.setMap(null)); _moRoutePolylines = [];
    _moMarkerOvs.forEach(m => m.setMap(null)); _moMarkerOvs = [];
    _moInfoOvs.forEach(i => i.setMap(null)); _moInfoOvs = [];
    if (_moOriginMarkerOv) _moOriginMarkerOv.setMap(null);
    _moMap = null;
    _$('moAddrListScroll').innerHTML = '';
}

function _moLoadKakaoThenInit(results) {
    if (_moKakaoLoaded) { _moInitMap(results); return; }
    var sc = document.createElement('script');
    sc.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + MO_KAKAO_JS_KEY + '&libraries=services&autoload=false';
    sc.onload = () => kakao.maps.load(() => { _moKakaoLoaded = true; _moInitMap(results); });
    document.head.appendChild(sc);
}

function _moInitMap(results) {
    _moOkList = results.filter(r => r.ok);
    _$('moMapArea').innerHTML = '<div id="moMap" style="width:100%;height:300px"></div>';
    _moMap = new kakao.maps.Map(_$('moMap'), { center: new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng), level: 7 });
    var bounds = new kakao.maps.LatLngBounds();
    bounds.extend(new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng));
    _moCustomOrder = _moOkList.map((_, i) => i);

    _moOkList.forEach((r, i) => {
        var pos = new kakao.maps.LatLng(r.lat, r.lng);
        bounds.extend(pos);
        var mEl = document.createElement('div'); mEl.className = 'kk-marker'; mEl.textContent = i + 1;
        new kakao.maps.CustomOverlay({ position: pos, content: mEl, yAnchor: 1 }).setMap(_moMap);
    });
    _moMap.setBounds(bounds);
    _moRebuildList();
}

function _moRebuildList() {
    var scroll = _$('moAddrListScroll');
    if (!scroll) return;
    scroll.innerHTML = _moOkList.map((r, i) => `
        <div class="mo-addr-item">
            <div class="mo-addr-num num-amber">${i + 1}</div>
            <div class="mo-addr-text"><b>${r.customer}</b><div class="detail">${r.addr}</div></div>
        </div>
    `).join('');
}
