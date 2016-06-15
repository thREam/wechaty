/**
 *
 * Wechaty - Wechat for Bot, and human who talk to bot.
 *
 * Class PuppetWebInjectio
 *
 * Inject this js code to browser,
 * in order to interactive with wechat web program.
 *
 * Licenst: MIT
 * https://github.com/zixia/wechaty-lib
 *
 */

/*global angular*/

return (function(port) {
  port = port || 8788

  if (typeof Wechaty !== 'undefined') {
    return 'Wechaty already injected?'
  }

  var Wechaty = {
    glue: {
      // will be initialized by glueAngular() function
    }

    // glue funcs
    , getLoginStatusCode: function() { return Wechaty.glue.loginScope.code }
    , getLoginQrImgUrl:   function() { return Wechaty.glue.loginScope.qrcodeUrl }
    , isReady:            isReady

    // variable
    , vars: {
      logined:      false
      , inited:     false

      , socket:     null
      , eventsBuf:  []
      , scanCode:   null
      , heartBeatTimmer:   null
    }

    // funcs
    , init: init  // initialize Wechaty @ Browser
    , send: send  // send message to wechat user
    , clog: clog  // log to Console
    , slog: slog  // log to SocketIO
    , log:  log   // log to both Console & SocketIO
    , ding: ding  // simple return 'dong'
    , quit: quit  // quit wechat
    , emit: emit  // send event to server

    , getContact: getContact
    , getUserName: getUserName
    , getMsgImg: getMsgImg
  }

  window.Wechaty = Wechaty

  if (isWxLogin()) {
    login('page refresh')
  }

  /**
   * Two return mode of WebDriver (should be one of them at a time)
   * 1. a callback. return a value by call callback with args
   * 2. direct return
   */
  var callback = arguments[arguments.length - 1]
  if (typeof callback === 'function') {
    return callback('Wechaty')
  } else {
    return 'Wechaty'
  }

  return 'Should not run to here'

  /////////////////////////////////////////////////////////////////////////////

  /**
  *
  * Functions that Glued with AngularJS
  *
  */
  function isWxLogin() { return !!(window.MMCgi && window.MMCgi.isLogin) }
  function isReady() {
    return !!(
      (typeof angular) !== 'undefined'
      && angular.element
      && angular.element('body')
    )
  }
  function init() {
    if (Wechaty.vars.inited === true) {
      log('Wechaty.init() called twice: already inited')
      return 'init: already inited'
    }

    if (!isReady()) {
      clog('angular not ready. wait 500ms...')
      setTimeout(init, 1000)
      return 'init: entered waiting angular loop'// AngularJS not ready, wait 500ms then try again.
    }

    clog('init on port:' + port)
    glueAngular()
    connectSocket()
    hookEvents()

    checkScan()

    heartBeat(true)

    clog('inited!. ;-D')
    Wechaty.vars.inited = true
    return 'init: success'
  }

  function heartBeat(firstTime) {
    var TIMEOUT = 15000 // 15s
    if (firstTime && Wechaty.vars.heartBeatTimmer) {
      Wechaty.log('heartBeat timer exist when 1st time is true? return for do nothing')
      return
    }
    Wechaty.emit('ding', 'heartbeat@browser')
    Wechaty.vars.heartBeatTimmer = setTimeout(heartBeat, TIMEOUT)
    return TIMEOUT
  }

  function glueAngular() {
    var injector  = angular.element(document).injector()

    var accountFactory  = injector.get('accountFactory')
    var appFactory      = injector.get('appFactory')
    var chatFactory     = injector.get('chatFactory')
    var contactFactory  = injector.get('contactFactory')
    var confFactory     = injector.get('confFactory')

    var http            = injector.get('$http')
    var mmHttp          = injector.get('mmHttp')

    var appScope    = angular.element('[ng-controller="appController"]').scope()
    var rootScope   = injector.get('$rootScope')
    var loginScope  = angular.element('[ng-controller="loginController"]').scope()

/*
    // method 1
    appFactory.syncOrig = appFactory.sync
    appFactory.syncCheckOrig = appFactory.syncCheck
    appFactory.sync = function() { Wechaty.log('appFactory.sync() !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'); return appFactory.syncOrig(arguments) }
    appFactory.syncCheck = function() { Wechaty.log('appFactory.syncCheck() !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'); return appFactory.syncCheckOrig(arguments) }

    // method 2
    $.ajaxOrig = $.ajax
    $.ajax = function() { Wechaty.log('$.ajax() !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'); return $.ajaxOrig(arguments) }

    $.ajax({
      url: "https://wx.qq.com/zh_CN/htmledition/v2/images/webwxgeticon.jpg"
      , type: "GET"
    }).done(function (response) {
      alert("success");
    })

    // method 3 - mmHttp
    mmHttp.getOrig = mmHttp.get
    mmHttp.get = function() { Wechaty.log('mmHttp.get() !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'); return mmHttp.getOrig(arguments) }
*/

    /**
     * generate $scope with a contoller (as it is not assigned in html staticly)
     * https://github.com/angular/angular.js/blob/a4e60cb6970d8b6fa9e0af4b9f881ee3ba7fdc99/test/ng/controllerSpec.js#L24
     */
    var contentChatScope  = rootScope.$new()
    injector.get('$controller')('contentChatController', {$scope: contentChatScope })
    /*
    s =

    */

    // get all we need from wx in browser(angularjs)
    Wechaty.glue = {
      injector:       injector
      , http:         http

      , accountFactory: accountFactory
      , chatFactory:    chatFactory
      , confFactory:    confFactory
      , contactFactory: contactFactory

      , rootScope:    rootScope
      , appScope:     appScope
      , loginScope:   loginScope

      , contentChatScope: contentChatScope
    }
  }

  function checkScan() {
    clog('checkScan()')
    if (isLogin()) {
      log('checkScan() - already login, no more check')
      return
    }
    if (!Wechaty.glue.loginScope) {
      log('checkScan() - loginScope disappeared, no more check')
      login('loginScope disappeared')
      return
    }

    // loginScope.code:
    // 0:   显示二维码
    // 201: 扫描，未确认
    // 200: 登录成功
    // 408: 未确认
    var code  = +Wechaty.glue.loginScope.code
    var url   =  Wechaty.glue.loginScope.qrcodeUrl
    if (url && code !== Wechaty.vars.scanCode) {

      log('checkScan() - code change detected. from '
        + Wechaty.vars.scanCode
        + ' to '
        + code
      )
      Wechaty.emit('scan', {
        code:   code
        , url:  url
      })
      Wechaty.vars.scanCode = code
    }
    setTimeout(checkScan, 1000)
    return
  }

  function isLogin() { return !!Wechaty.vars.logined }
  function login(data) {
    clog('login(' + data + ')')
    Wechaty.vars.logined = true
    Wechaty.emit('login', data)
  }
  function logout(data) {
    clog('logout(' + data + ')')
    Wechaty.vars.logined = false
    Wechaty.emit('logout', data)
    checkScan()
  }
  function quit() {
    clog('quit()')
    logout('quit')
    if (Wechaty.vars.socket) {
      Wechaty.vars.socket.close()
      Wechaty.vars.socket = null
    }
  }
  function log(s)     { clog(s); slog(s) }
  function slog(msg) {
    // keep this emit directly to use socket.emit instead of Wechaty.emit
    // to prevent lost log msg if there has any bug in Wechaty.emit
    return Wechaty.vars.socket && Wechaty.vars.socket.emit('log', msg)
  }
  function ding()     { log('recv ding'); return 'dong' }
  function send(ToUserName, Content) {
    var chat = Wechaty.glue.chatFactory
    var m = chat.createMessage({
      ToUserName: ToUserName
      , Content: Content
      , MsgType: Wechaty.glue.confFactory.MSGTYPE_TEXT
    })
    chat.appendMessage(m)
    return chat.sendMessage(m)
  }
  function getContact(id) {
    if (Wechaty.glue.contactFactory) {
      var c = Wechaty.glue.contactFactory.getContact(id)
      if (c && c.isContact) {
        c.stranger = !(c.isContact())
      }
      return c
    }
    log('contactFactory not inited')
    return null
  }
  function getUserName() {
    return Wechaty.glue.accountFactory
    ? Wechaty.glue.accountFactory.getUserName()
    : null
  }
  function hookEvents() {
    Wechaty.glue.rootScope.$on('message:add:success', function(event, data) {
      if (!isLogin()) { // in case of we missed the pageInit event
        login('by event[message:add:success]')
      }
      Wechaty.emit('message', data)
    })
    Wechaty.glue.appScope.$on("newLoginPage", function(event, data) {
      login('by event[newLoginPage]')
    })
    Wechaty.glue.rootScope.$on('root:pageInit:success'), function (event, data) {
      login('by event[root:pageInit:success]')
    }
    window.addEventListener('unload', function(e) {
      // XXX only 1 event can be emitted here???
      Wechaty.emit('unload', e)
      // Wechaty.slog('emit unload')
      // Wechaty.emit('logout', e)
      // Wechaty.slog('emit logout')
      // Wechaty.slog('emit logout&unload over')
    })
  }
  // Wechaty.emit, will save event & data when there's no socket io connection to prevent event lost
  function emit(event, data) {
    if (event) {
      Wechaty.vars.eventsBuf.push([event, data])
    }
    if (!Wechaty.vars.socket) {
      clog('Wechaty.vars.socket not ready')
      return setTimeout(emit, 1000) // resent eventsBuf after 1000ms
    }
    var bufLen = Wechaty.vars.eventsBuf.length
    if (bufLen) {
      if (bufLen > 1) { clog('Wechaty.vars.eventsBuf has ' + bufLen + ' unsend events') }

      while (Wechaty.vars.eventsBuf.length) {
        var eventData = Wechaty.vars.eventsBuf.pop()
        if (eventData && eventData.map && eventData.length===2) {
          clog('emiting ' + eventData[0])
          Wechaty.vars.socket.emit(eventData[0], eventData[1])
        } else { clog('Wechaty.emit() got invalid eventData: ' + eventData[0] + ', ' + eventData[1] + ', length: ' + eventData.length) }
      }

      if (bufLen > 1) { clog('Wechaty.vars.eventsBuf all sent') }
    }
  }

  function connectSocket() {
    clog('connectSocket()')
    if (typeof io !== 'function') {
      clog('connectSocket: io not found. loading lib...')
      // http://stackoverflow.com/a/3248500/1123955
      var script = document.createElement('script')
      script.onload = function() {
        clog('socket io lib loaded.')
        setTimeout(connectSocket, 50)
      }
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/socket.io/1.4.5/socket.io.min.js'
      document.getElementsByTagName('head')[0].appendChild(script)
      return // wait to be called via script.onload()
    }

    /*global io*/ // Wechaty global variable: socket
    var socket  = Wechaty.vars.socket = io.connect('https://127.0.0.1:' + port)

    // ding -> dong. for test & live check purpose
    // ping/pong are reserved by socket.io https://github.com/socketio/socket.io/issues/2414
    socket.on('ding', function(e) {
      clog('received socket io event: ding. emit dong...')
      socket.emit('dong', 'dong')
    })

    socket.on('connect'   , function(e) { clog('connected to server:' + e) })
    socket.on('disconnect', function(e) { clog('socket disconnect:' + e) })
  }
  /**
  * Log to console
  * http://stackoverflow.com/a/7089553/1123955
  */
  function clog(s) {
    var d = new Date()
    s = d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds() + ' <Wechaty> ' + s

    /**
     * FIXME: WARN PuppetWebBridge inject() exception: {"errorMessage":"null is not an object (evaluating 'document.body.appendChild')"
     * when will document.createElement('iframe') return null?
     * this will cause the bridge init fail, and retry.
     * should it be ignored? or keep this exception to retry is better?
     */
    var i = document.createElement('iframe')
    i.style.display = 'none'
    document.body.appendChild(i)
    i.contentWindow.console.log(s)
    i.parentNode.removeChild(i)
  }

  function getMsgImg(id) {
    var location = window.location.href.replace(/\/$/, '')
    var path = Wechaty.glue.contentChatScope.getMsgImg(id)
    return location + path
  }
}.apply(window, arguments))
