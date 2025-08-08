const path = require('path');
const { task, src, dest, parallel } = require('gulp');

task('build:icons', copyNodeIcons);

function copyNodeIcons() {
	const nodeSource = path.resolve('nodes', '**', '*.{png,svg}');
	const nodeDestination = path.resolve('dist', 'nodes');

	return src(nodeSource).pipe(dest(nodeDestination));
}

function copyCredentialIcons() {
	const credentialSource = path.resolve('credentials', '**', '*.{png,svg}');
	const credentialDestination = path.resolve('dist', 'credentials');

	return src(credentialSource).pipe(dest(credentialDestination));
}
