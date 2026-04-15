/**
 * BrightScript source files for the on-device ODC component.
 * These get injected into a Roku channel at sideload time.
 */

export const SERVER_XML = `<?xml version="1.0" encoding="utf-8" ?>
<component name="RokuODC" extends="Task">
  <interface>
    <field id="port" type="integer" value="8061" />
  </interface>
  <script type="text/brightscript" uri="RokuODC.brs" />
</component>
`;

export const SERVER_BRS = `' roku-odc: On-Device Components HTTP server
' Provides registry, file, and app-ui access over HTTP.

sub init()
  m.top.functionName = "odcStartServer"
  m.top.control = "RUN"
end sub

' ---------- HTTP Server ----------

sub odcStartServer()
  port = createObject("roMessagePort")

  addr = createObject("roSocketAddress")
  addr.setPort(m.top.port)

  tcp = createObject("roStreamSocket")
  tcp.setMessagePort(port)
  tcp.notifyReadable(true)
  tcp.setAddress(addr)
  tcp.listen(4)

  if not tcp.eOK()
    print "[roku-odc] Failed to start server on port "; m.top.port
    return
  end if

  print "[roku-odc] Listening on port "; m.top.port

  serverId = stri(tcp.getID())
  sessions = {}
  connections = {}
  buf = createObject("roByteArray")

  while true
    event = wait(0, port)
    if type(event) <> "roSocketEvent" then goto odcNextEvent

    connId = stri(event.getSocketID())

    ' --- New connection ---
    if connId = serverId and tcp.isReadable()
      conn = tcp.accept()
      if conn <> invalid
        conn.notifyReadable(true)
        conn.setMessagePort(port)
        connId = stri(conn.getID())
        connections[connId] = conn
      end if
      goto odcNextEvent
    end if

    conn = connections[connId]
    if conn = invalid then goto odcNextEvent

    ' --- Read data ---
    bufSize = conn.getCountRcvBuf()
    if bufSize = 0
      conn.close()
      sessions.delete(connId)
      connections.delete(connId)
      goto odcNextEvent
    end if

    buf[bufSize - 1] = 0
    bufSize = conn.receive(buf, 0, bufSize)

    ' --- Get or create session ---
    session = sessions[connId]
    if session = invalid
      session = {
        method: "",
        path: "",
        query: {},
        headers: {},
        bodyBytes: createObject("roByteArray"),
        contentLength: 0,
        headersParsed: false,
        rawHeader: createObject("roByteArray")
      }
      sessions[connId] = session
    end if

    ' --- Accumulate data ---
    if not session.headersParsed
      for i = 0 to bufSize - 1
        session.rawHeader.push(buf[i])
      end for
      odcTryParseHeaders(session)
      if not session.headersParsed then goto odcNextEvent
    else
      for i = 0 to bufSize - 1
        session.bodyBytes.push(buf[i])
      end for
    end if

    ' --- Check if body is complete ---
    if session.bodyBytes.count() < session.contentLength
      goto odcNextEvent
    end if

    ' --- Handle request ---
    sessions.delete(connId)
    body = ""
    if session.bodyBytes.count() > 0
      body = session.bodyBytes.toAsciiString()
    end if

    response = odcRouteRequest(session.method, session.path, session.query, session.headers, body)
    odcSendResponse(conn, response)

    conn.close()
    connections.delete(connId)

    odcNextEvent:
  end while
end sub

sub odcTryParseHeaders(session as object)
  raw = session.rawHeader
  count = raw.count()
  if count < 4 then return

  ' Look for \\r\\n\\r\\n (13,10,13,10)
  headerEnd = -1
  for i = 0 to count - 4
    if raw[i] = 13 and raw[i + 1] = 10 and raw[i + 2] = 13 and raw[i + 3] = 10
      headerEnd = i
      exit for
    end if
  end for

  if headerEnd = -1 then return

  ' Extract header text
  headerBytes = createObject("roByteArray")
  for i = 0 to headerEnd - 1
    headerBytes.push(raw[i])
  end for
  headerText = headerBytes.toAsciiString()

  ' Move remaining bytes to body
  bodyStart = headerEnd + 4
  for i = bodyStart to count - 1
    session.bodyBytes.push(raw[i])
  end for

  ' Parse request line and headers
  lines = createObject("roRegex", chr(13) + chr(10), "").split(headerText)

  if lines.count() = 0 then return

  ' Request line: METHOD /path HTTP/1.1
  reqParts = lines[0].split(" ")
  if reqParts.count() >= 2
    session.method = uCase(reqParts[0])
    fullPath = reqParts[1]

    qPos = instr(1, fullPath, "?")
    if qPos > 0
      session.path = left(fullPath, qPos - 1)
      odcParseQuery(mid(fullPath, qPos + 1), session.query)
    else
      session.path = fullPath
    end if
  end if

  ' Headers
  for i = 1 to lines.count() - 1
    line = lines[i]
    cPos = instr(1, line, ":")
    if cPos > 0
      key = left(line, cPos - 1)
      value = mid(line, cPos + 1)
      ' Trim leading space
      if left(value, 1) = " " then value = mid(value, 2)
      session.headers[lCase(key)] = value
    end if
  end for

  ' Content length
  cl = session.headers["content-length"]
  if cl <> invalid
    session.contentLength = val(cl)
  end if

  session.headersParsed = true
end sub

sub odcParseQuery(qs as string, result as object)
  pairs = qs.split("&")
  for each pair in pairs
    eqPos = instr(1, pair, "=")
    if eqPos > 0
      key = left(pair, eqPos - 1)
      value = mid(pair, eqPos + 1)
      result[odcUrlDecode(key)] = odcUrlDecode(value)
    else
      result[odcUrlDecode(pair)] = ""
    end if
  end for
end sub

function odcUrlDecode(str as string) as string
  result = ""
  i = 1
  while i <= len(str)
    ch = mid(str, i, 1)
    if ch = "%" and i + 2 <= len(str)
      hi = odcHexVal(mid(str, i + 1, 1))
      lo = odcHexVal(mid(str, i + 2, 1))
      result = result + chr(hi * 16 + lo)
      i = i + 3
    else if ch = "+"
      result = result + " "
      i = i + 1
    else
      result = result + ch
      i = i + 1
    end if
  end while
  return result
end function

function odcHexVal(ch as string) as integer
  c = asc(lCase(ch))
  if c >= 48 and c <= 57 then return c - 48
  if c >= 97 and c <= 102 then return c - 87
  return 0
end function

sub odcSendResponse(conn as object, response as object)
  crlf = chr(13) + chr(10)

  headerStr = "HTTP/1.1 " + stri(response.status).trim() + " " + response.statusText + crlf
  headerStr = headerStr + "Content-Type: " + response.contentType + crlf
  headerStr = headerStr + "Connection: close" + crlf

  bodyBytes = createObject("roByteArray")
  if response.bodyBytes <> invalid
    bodyBytes = response.bodyBytes
  else if response.body <> invalid
    bodyBytes.fromAsciiString(response.body)
  end if

  headerStr = headerStr + "Content-Length: " + stri(bodyBytes.count()).trim() + crlf + crlf

  packet = createObject("roByteArray")
  packet.fromAsciiString(headerStr)
  packet.append(bodyBytes)

  idx = 0
  total = packet.count()
  while conn.status() = 0 and idx < total
    while conn.getCountSendBuf() <> 0
    end while
    idx = idx + conn.send(packet, idx, total - idx)
  end while
end sub

' ---------- Router ----------

function odcRouteRequest(method as string, path as string, query as object, headers as object, body as string) as object
  try
    if path = "/registry"
      if method = "GET" then return odcGetRegistry()
      if method = "PATCH" then return odcPatchRegistry(body)
      if method = "DELETE" then return odcDeleteRegistry()
    else if path = "/app-ui"
      if method = "GET" then return odcGetAppUi(query)
    else if path = "/files"
      if method = "GET" then return odcGetFiles(query)
    else if path = "/file"
      if method = "GET" then return odcGetFile(query)
      if method = "PUT" then return odcPutFile(query, body, headers)
    end if

    return { status: 404, statusText: "Not Found", contentType: "application/json", body: formatJson({ message: "not found" }), bodyBytes: invalid }
  catch e
    return { status: 500, statusText: "Internal Server Error", contentType: "application/json", body: formatJson({ message: e.message }), bodyBytes: invalid }
  end try
end function

' ---------- Registry handlers ----------

function odcGetRegistry() as object
  sections = {}
  registry = createObject("roRegistry")
  for each name in registry.getSectionList()
    section = createObject("roRegistrySection", name)
    sections[name] = section.readMulti(section.getKeyList())
  end for
  return { status: 200, statusText: "OK", contentType: "application/json", body: formatJson(sections), bodyBytes: invalid }
end function

function odcPatchRegistry(body as string) as object
  data = parseJson(body)
  if data = invalid
    return { status: 400, statusText: "Bad Request", contentType: "application/json", body: formatJson({ message: "invalid JSON" }), bodyBytes: invalid }
  end if

  registry = createObject("roRegistry")
  for each item in data.items()
    if item.value = invalid
      registry.delete(item.key)
    else
      section = createObject("roRegistrySection", item.key)
      for each entry in item.value.items()
        if entry.value = invalid
          section.delete(entry.key)
        else
          section.write(entry.key, odcToString(entry.value))
        end if
      end for
      section.flush()
    end if
  end for
  registry.flush()

  return { status: 204, statusText: "No Content", contentType: "text/plain", body: "", bodyBytes: invalid }
end function

function odcDeleteRegistry() as object
  registry = createObject("roRegistry")
  for each name in registry.getSectionList()
    registry.delete(name)
  end for
  registry.flush()
  return { status: 204, statusText: "No Content", contentType: "text/plain", body: "", bodyBytes: invalid }
end function

' ---------- App UI handler ----------

function odcGetAppUi(query as object) as object
  scene = m.top.getScene()
  if scene = invalid
    return { status: 500, statusText: "Internal Server Error", contentType: "application/json", body: formatJson({ message: "no scene available" }), bodyBytes: invalid }
  end if

  fields = invalid
  if query.doesExist("fields")
    fields = parseJson(query.fields)
  end if

  xml = odcSerializeNodeXml(scene, fields)
  return { status: 200, statusText: "OK", contentType: "text/xml", body: xml, bodyBytes: invalid }
end function

function odcSerializeNodeXml(node as object, fields as object) as string
  xmlNode = createObject("roXMLElement")
  xmlNode.setName("xml")
  odcBuildXmlTree(xmlNode, node, fields)
  return xmlNode.genXML(false)
end function

sub odcBuildXmlTree(parent as object, node as object, fields as object)
  el = parent.addElement(node.subtype())

  ' Add fields as attributes
  if fields <> invalid
    ' Filtered: only include specified fields per subtype
    subtype = node.subtype()
    filterKeys = invalid
    if fields.doesExist(subtype)
      filterKeys = fields[subtype]
    else if fields.doesExist("*")
      filterKeys = fields["*"]
    end if

    if filterKeys <> invalid
      for each key in filterKeys
        if node.doesExist(key)
          val = node.getField(key)
          if val <> invalid
            el.addAttribute(key, odcToString(val))
          end if
        end if
      end for
    end if
  else
    ' No filter: include all string-representable fields
    for each key in node.keys()
      fieldType = node.getFieldType(key)
      if fieldType <> "node" and fieldType <> "nodearray" and fieldType <> "function"
        val = node.getField(key)
        if val <> invalid and getInterface(val, "ifToStr") <> invalid
          el.addAttribute(key, val.toStr())
        end if
      end if
    end for
  end if

  ' Recurse into children
  for i = 0 to node.getChildCount() - 1
    child = node.getChild(i)
    if child.id <> "__roku_odc"
      odcBuildXmlTree(el, child, fields)
    end if
  end for
end sub

' ---------- File handlers ----------

function odcGetFiles(query as object) as object
  path = "pkg:/"
  if query.doesExist("path")
    path = query.path
  end if

  fs = createObject("roFileSystem")
  listing = fs.getDirectoryListing(path)
  results = []

  for each name in listing
    fullPath = path + "/" + name
    stat = fs.stat(fullPath)
    entry = { name: name, type: stat.type }
    if stat.type = "file"
      entry.size = stat.size
    end if
    results.push(entry)
  end for

  return { status: 200, statusText: "OK", contentType: "application/json", body: formatJson(results), bodyBytes: invalid }
end function

function odcGetFile(query as object) as object
  if not query.doesExist("source")
    return { status: 400, statusText: "Bad Request", contentType: "application/json", body: formatJson({ message: "missing source param" }), bodyBytes: invalid }
  end if

  ba = createObject("roByteArray")
  ok = ba.readFile(query.source)
  if not ok
    return { status: 404, statusText: "Not Found", contentType: "application/json", body: formatJson({ message: "file not found" }), bodyBytes: invalid }
  end if

  return { status: 200, statusText: "OK", contentType: "application/octet-stream", body: invalid, bodyBytes: ba }
end function

function odcPutFile(query as object, body as string, headers as object) as object
  if not query.doesExist("destination")
    return { status: 400, statusText: "Bad Request", contentType: "application/json", body: formatJson({ message: "missing destination param" }), bodyBytes: invalid }
  end if

  dest = query.destination

  ' Ensure parent directories exist
  pathObj = createObject("roPath", dest)
  parts = pathObj.split()
  if parts.parent <> invalid
    odcMakeDirs(parts.parent)
  end if

  ba = createObject("roByteArray")
  ba.fromAsciiString(body)
  ok = ba.writeFile(dest)

  if not ok
    return { status: 400, statusText: "Bad Request", contentType: "application/json", body: formatJson({ message: "failed to write file" }), bodyBytes: invalid }
  end if

  return { status: 204, statusText: "No Content", contentType: "text/plain", body: "", bodyBytes: invalid }
end function

sub odcMakeDirs(path as string)
  fs = createObject("roFileSystem")
  if fs.exists(path) then return

  dirs = []
  current = path
  while not fs.exists(current)
    dirs.push(current)
    parentPath = createObject("roPath", current).split()
    if parentPath.parent = invalid then exit while
    current = parentPath.parent
  end while

  for i = dirs.count() - 1 to 0 step -1
    fs.createDirectory(dirs[i])
  end for
end sub

' ---------- Helpers ----------

function odcToString(value as object) as string
  if getInterface(value, "ifToStr") <> invalid
    return value.toStr()
  end if
  return formatJson(value)
end function
`;

/**
 * BrightScript hook that runs at channel launch before the main scene.
 * Handles pre-launch registry setup, channel data injection, and entry point selection.
 */
export const MAIN_BRS = `' roku-odc: Launch hook for pre-launch configuration
sub odcMain(args as object)
  if args.odc_clear_registry = "true"
    registry = createObject("roRegistry")
    for each name in registry.getSectionList()
      registry.delete(name)
    end for
    registry.flush()
  end if

  if args.odc_registry <> invalid
    data = parseJson(args.odc_registry)
    if data <> invalid
      registry = createObject("roRegistry")
      for each item in data.items()
        section = createObject("roRegistrySection", item.key)
        for each entry in item.value.items()
          if entry.value = invalid
            section.delete(entry.key)
          else
            valStr = entry.value
            if getInterface(valStr, "ifToStr") <> invalid
              valStr = valStr.toStr()
            else
              valStr = formatJson(valStr)
            end if
            section.write(entry.key, valStr)
          end if
        end for
        section.flush()
      end for
      registry.flush()
    end if
  end if

  if args.odc_channel_data <> invalid
    store = createObject("roChannelStore")
    store.storeChannelCredData(args.odc_channel_data)
  end if

  if args.odc_entry_point <> invalid
    if args.odc_entry_point = "screensaver"
      RunScreenSaver()
    else if args.odc_entry_point = "screensaver-settings"
      RunScreenSaverSettings()
    end if

    if args.odc_entry_point <> "channel"
      END
    end if
  end if
end sub
`;

/** Files to inject into the channel zip, relative to the zip root. */
export const COMPONENT_FILES: Record<string, string> = {
  'components/roku-odc/RokuODC.xml': SERVER_XML,
  'components/roku-odc/RokuODC.brs': SERVER_BRS,
  'source/roku-odc/odcMain.brs': MAIN_BRS,
};
