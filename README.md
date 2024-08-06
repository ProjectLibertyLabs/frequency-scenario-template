# Frequency Scenario Template

Scaffolding and examples for scripting scenarios and setup for a local Frequency blockchain environment

To run an example script use the following command: `npm run run-example --example=script-name`

### Frequency Access (FA) Scripts

The FA scripts folder are a group of scrips useful for bootstrapping and creating data for manual testing of FA.
Currently, there are two scripts that can be used.

#### Startup

The startup script is used to boostrap the chain with the needed data for manually testing FA with the
chain locally. This script can be run with the command: `npm run run-example --example=frequency-access/fa-startup`

#### Create User

This script utilizes the payload returned from FA to create a delegated user on the chain with
a handle. This script requires a JSON file be created with the FA signup response in it. An example
of this is in the `signup-response.json.example`. After creating your JSON file in the FA folder, you can run the create
user command with an extra parameter to specify the JSON file name:
`npm run run-example --example=frequency-access/create-mewe-user -- --response signup-response.json`
