import { PrismLight as Highlighter } from 'react-syntax-highlighter'

// pick only the languages you need
import tsx from 'refractor/tsx'
import typescript from 'refractor/typescript'
import javascript from 'refractor/javascript'
import json from 'refractor/json'
import python from 'refractor/python'
import cpp from 'refractor/cpp'
import c from 'refractor/c'
import java from 'refractor/java'
import abap from 'refractor/abap'
// add more as needed

Highlighter.registerLanguage('abap', abap)
Highlighter.registerLanguage('tsx', tsx)
Highlighter.registerLanguage('typescript', typescript)
Highlighter.registerLanguage('javascript', javascript)
Highlighter.registerLanguage('json', json)
Highlighter.registerLanguage('python', python)
Highlighter.registerLanguage('cpp', cpp)
Highlighter.registerLanguage('c', c)
Highlighter.registerLanguage('java', java)

export { Highlighter }
