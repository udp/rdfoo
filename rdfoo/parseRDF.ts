
import RdfParserXml = require('rdf-parser-rdfxml')
import RdfParserN3 = require('@rdfoo/rdf-parser-n3')
import Graph from './Graph'
import { Filetype } from './identifyFiletype';

export default async function parseRDF(graph:Graph, rdf:string, filetype:Filetype):Promise<void> {

    let parser:any = null

    if(filetype === Filetype.NTriples) {
        parser = new RdfParserN3()
    } else if(filetype === Filetype.RDFXML) {
        parser = new RdfParserXml()
    } else {
        throw new Error('Unknown type ' + filetype)
    }

    await parser.process(rdf, (triple) => {
        graph.graph.add(triple)
    })
}
