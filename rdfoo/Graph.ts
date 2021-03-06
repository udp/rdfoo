
import * as triple from './triple'
import * as node from './node'

import assert from 'power-assert'

import shortid = require('shortid')
import changeURIPrefix from './changeURIPrefix';
import Facade from './Facade'
import identifyFiletype from './identifyFiletype';
import parseRDF from './parseRDF';
import serialize from './serialize';
import N3Serializer from 'rdf-serializer-ntriples'

let RdfGraphArray = require('rdf-graph-array-sboljs').Graph

export interface Watcher {
    unwatch():void
}

export default class Graph {

    graph:any
    private ignoreWatchers:boolean

    constructor(triples?:Array<any>) {

        this.graph = triples ? new RdfGraphArray(triples) : new RdfGraphArray([])

        this._globalWatchers = new Array<() => void>()
        this._subjWatchers = new Map<string, Array<() => void>>()
        this.ignoreWatchers = false
    }

    match(s:string|null, p:string|null, o: string|number|null): Array<any> {

        if(s === undefined || p === undefined || o === undefined) {
            console.dir(arguments)
            throw new Error('one of s/p/o were undefined')
        }

        
        const res = this.graph.match(s, p, o).toArray()

        // console.log('Match { ' + s + ', ' + p + ', ' + o + ' } => ' + res.length)

        return res
    }

    matchOne(s:string|null, p:string|null, o: string|number|null) {

        if(s === undefined || p === undefined || o === undefined)
            throw new Error('one of s/p/o were undefined')

        if(!s && !o) {
            console.dir({ s, p, o })
            throw new Error('matchOne with only a predicate?')
        }

        if(!p && !o) {
            console.dir({ s, p, o })
            throw new Error('matchOne with only a subject?')
        }

        if(!s && !p) {
            console.dir({ s, p, o })
            throw new Error('matchOne with only an object?')
        }

        const matches = this.match(s, p, o)

        if(matches.length > 1) {
            console.error('results:')
            console.dir(matches)
            throw new Error('Got more than one result for matchOne { ' + [s, p, o].join(', ') + ' }')
        }

        return matches[0]
    }

    hasMatch(s:string|null, p: string|null, o: string|number|null):boolean {

        if(s === undefined || p === undefined || o === undefined)
            throw new Error('one of s/p/o were undefined')

        return this.match(s, p, o).length > 0

    }

    addAll(other:Graph) {
        this.graph.addAll(other.graph)
    }

    get subjects():string[] {

        let subjects:string[] = []

        for(let k of Object.keys(this.graph._gspo)) {
            subjects = subjects.concat(Object.keys(this.graph._gspo[k]))
        }

        return subjects
    }

    private fireWatchers(subj:string) {

        if(this.ignoreWatchers)
            return

        const watchers = this._subjWatchers.get(subj)

        if(watchers === undefined)
            return

        watchers.forEach((cb) => {
            cb()
        })
    }

    private fireGlobalWatchers():void {

        if(this.ignoreWatchers)
            return

        this._globalWatchers.forEach((cb) => cb())

    }

    insert(...args : any[]):void {

        if(arguments.length === 3) {

            this.graph.add({
                subject: node.createUriNode(arguments[0]),
                predicate: node.createUriNode(arguments[1]),
                object: arguments[2],
            })

            this.touchSubject(arguments[0])

        } else {

            assert(Array.isArray(arguments[0]))

            const w:Set<string> = new Set<string>()

            arguments[0].forEach((t) => {

                //console.log('Insert { ' + t.subject + ', ' + t.predicate + ', ' + t.object + ' }')

                this.insert(t.subject, t.predicate, t.object)

                w.add(t.subject)

            })

            w.forEach((uri:string) => {
                this.touchSubject(uri)
            })

        }
    }

    touchSubject(subject:string) {
        this.fireWatchers(subject)
        this.fireGlobalWatchers()
    }

    insertProperties(subject:string, properties:Object):void {

        var triples:any[] = []

        Object.keys(properties).forEach((property) => {

            assert(('' + property) !== 'undefined')

            var value = properties[property]

            if(Array.isArray(value)) {

                value.forEach((value) => {

                    triples.push({
                        subject: subject,
                        predicate: property,
                        object: value
                    })

                })

            } else {

                triples.push({
                    subject: subject,
                    predicate: property,
                    object: value
                })

            }

        })

        this.insert(triples)

    }

    removeMatches(s:string|null, p:string|null, o:string|number|null):void {

        if(s === undefined || p === undefined || o === undefined)
            throw new Error('one of s/p/o were undefined')

        //console.log('Remove matches { ' + s + ', ' + p + ', ' + o + ' }')

        const w: Set<string> = new Set<string>()

        const matches = this.match(s, p, o)

        matches.forEach((t) => {
            w.add(t.subject)
        })

        this.graph.removeMatches(s, p, o)

        w.forEach((uri: string) => {
            this.touchSubject(uri)
        })

        this.fireGlobalWatchers()
    }



    generateURI(template:string):string {

        var n = 1

        for(;;) {

            var uri:string =
                template.split('$rand$').join(shortid.generate())
                        .split('$^n$').join('' + n)
                        .split('$n$').join('_' + n)
                        .split('$n?$').join(n > 1 ? ('_' + n) : '')

            ++ n

            if(this.hasMatch(uri, null, null))
                continue

            return uri

        }

    }

    purgeSubject(subject:string):void {
        //console.log('purge ' + subject)
        this.graph.removeMatches(subject, null, null)
        this.graph.removeMatches(null, null, subject)
    }

    replaceURI(oldURI:string, newURI:string) {

        // TODO: do this in-place instead of creating a new graph
        //
        let newGraph = new RdfGraphArray()
        
        for(let triple of this.graph._graph) {

            newGraph.add({
                subject: replace(triple.subject),
                predicate: replace(triple.predicate),
                object: replace(triple.object)
            })
        }

        this.graph = newGraph

        function replace(n) {
            if(n.interfaceName !== 'NamedNode')
                return n
            if(n.nominalValue !== oldURI)
                return n
            return node.createUriNode(newURI)
        }
    }

    _globalWatchers:Array<() => void>
    _subjWatchers:Map<string, Array<() => void>>

    watchSubject(uri:string, cb:() => void):Watcher {

        const watchers:Array<() => void>|undefined = this._subjWatchers.get(uri)
        
        if(watchers === undefined) {
            this._subjWatchers.set(uri, [ cb ])
        } else {
            watchers.push(cb)
        }

        return {
            unwatch: () => {

                const watchers: Array<() => void> | undefined = this._subjWatchers.get(uri)

                if(watchers !== undefined) {
                    for(var i = 0; i < watchers.length; ++ i) {
                        if(watchers[i] === cb) {
                            watchers.splice(i, 1)
                            break
                        }
                    }

                    if(watchers.length === 0) {
                        this._subjWatchers.delete(uri)
                    }
                }
            }
        }

    }

    watch(cb:()=>void):Watcher {

        this._globalWatchers.push(cb)

        return {

            unwatch: () => {
                for(var i = 0; i < this._globalWatchers.length; ++ i) {
                    if(this._globalWatchers[i] === cb) {
                        this._globalWatchers.splice(i, 1)
                        break
                    }
                }
            }
        }

    }

    static async loadString(data:string, defaultURIPrefix?:string, mimeType?:string):Promise<Graph> {

        let graph = new Graph()
        await graph.loadString(data, defaultURIPrefix, mimeType)
        return graph

    }

    async loadString(data:string, defaultURIPrefix?:string, mimeType?:string):Promise<void> {

        let filetype = identifyFiletype(data, mimeType || null)

        if(filetype === null) {
            throw new Error('???')
        }

        await parseRDF(this, data, filetype)
    }

    startIgnoringWatchers() {
        this.ignoreWatchers = true
    }

    stopIgnoringWatchers() {
        this.ignoreWatchers = false
    }

    toArray():any[] {
        return this.graph.toArray()
    }

    clone():Graph {
        return new Graph(this.graph.toArray())
    }

    serializeXML() {
        return serialize(this, new Map(), () => false, '')
    }

    serializeN3() {
        let serializer = new (new N3Serializer()).Impl(this.graph)
        console.dir(serializer)
    }



}

